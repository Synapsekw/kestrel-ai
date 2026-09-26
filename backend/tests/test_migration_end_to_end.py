"""The armed migration end to end (foundation spec §16 "Migration", §17.7, D6, F4)."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from migration_helpers import (
    AUTH,
    add_cloud_rows,
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    arm,
    at_revision,
    catalogue_types,
    env_for,
    needs_classification,
    open_handle,
    open_stores,
    revision_of,
    run_step,
    wait_library_job,
)
from sqlalchemy import text

from app.appdata import AppData
from app.migration import ports, steps
from app.migration.backup import latest_backup
from app.migration.invariants import compare, snapshot
from app.migration.pipeline import MigrationEnv, Step, StepFailed, run_pipeline
from app.migration.state import MigrationStates

NORTH = [
    {"id": "a-exc", "name": "excavator", "colour": "#f97316", "hotkey": "1", "order": 0},
    {"id": "a-dump", "name": "dump_truck", "colour": "#06b6d4", "hotkey": "2", "order": 1},
]
SOUTH = [
    {"id": "b-dump", "name": "Dump truck", "colour": "#ff0000", "hotkey": "3", "order": 0},
    {"id": "b-crane", "name": "crane", "colour": "#3b82f6", "hotkey": "2", "order": 1},
]


def _north_and_south(tmp_path):
    a = at_revision(tmp_path / "north", "0009", pid="pa", name="North", classes=NORTH)
    add_images_and_boxes(a, classes=NORTH)
    add_detect_rows(a, classes=NORTH)
    add_cloud_rows(a)
    add_dataset(a, classes=NORTH)
    b = at_revision(tmp_path / "south", "0009", pid="pb", name="South", classes=SOUTH)
    add_images_and_boxes(b, classes=SOUTH)
    return a, b


def _remember(settings, *entries):
    recent = AppData(settings.data_dir)
    for pid, name, folder in entries:
        recent.remember(pid, name, str(folder))


def _wait_all(c, settings, *folders):
    states = MigrationStates(settings.data_dir)
    for folder in folders:
        assert wait_library_job(c, states.get(folder)["job_id"])["state"] == "succeeded", folder
        assert states.get(folder)["state"] == "ok"


def _type_ids(handle):
    with handle.session() as s:
        return list(s.execute(text("SELECT type_id FROM project_type ORDER BY position")).scalars())


def test_two_projects_upgrade_at_startup_into_one_catalogue(app, settings, tmp_path):
    a, b = _north_and_south(tmp_path)
    before = {f: snapshot(f / "project.db") for f in (a, b)}
    _remember(settings, ("pb", "South", b), ("pa", "North", a))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, a, b)
        for pid in ("pa", "pb"):
            assert c.get(f"/api/v1/projects/{pid}").status_code == 200
        # The library runner has two workers, so which spelling of the shared class reached the
        # catalogue first ("dump_truck" or "Dump truck") is a race: compare by normalised name.
        types = {ports.normalise_name(n): t for n, t in catalogue_types(app.state.catalogue).items()}
        excavator, dump_truck, crane = (ports.normalise_name(n) for n in ("excavator", "dump_truck", "crane"))
        assert set(types) == {excavator, dump_truck, crane}
        assert all(t["kind"] == "object" and t["origin"] == "migrated" for t in types.values())
        assert needs_classification(app.state.catalogue)
        ha, hb = app.state.projects.get("pa"), app.state.projects.get("pb")
        assert _type_ids(ha) == [types[excavator]["id"], types[dump_truck]["id"]]
        assert _type_ids(hb) == [types[dump_truck]["id"], types[crane]["id"]]
        with hb.session() as s:
            assert set(s.execute(text("SELECT DISTINCT class_id FROM box")).scalars()) == set(_type_ids(hb))
        for h in (ha, hb):
            # F4: migrated types are objects, so the upgrade creates no findings.
            with h.session() as s:
                assert s.execute(text("SELECT COUNT(*) FROM finding")).scalar_one() == 0
                assert s.execute(text("SELECT COUNT(*) FROM finding_count")).scalar_one() == 0
        for folder in (a, b):
            report = json.loads((folder / "backups" / "migration-v2.json").read_text("utf-8"))
            assert [s["name"] for s in report["steps"]] == [s.name for s in steps.PIPELINE]
            assert revision_of(latest_backup(folder)) == "0009"
    for folder in (a, b):
        assert compare(before[folder], snapshot(folder / "project.db")) == []


def test_a_pre_0007_training_project_upgrades_and_keeps_its_dataset(app, settings, tmp_path):
    folder = at_revision(tmp_path / "train", "0006", pid="pt", name="Train")
    add_images_and_boxes(folder)
    add_dataset(folder)
    _remember(settings, ("pt", "Train", folder))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, folder)
        with app.state.library.session() as ls:
            rows = ls.execute(text("SELECT name, legacy_path FROM dataset WHERE origin = 'legacy'")).all()
    assert [tuple(r) for r in rows] == [("v1 (Train)", str((folder / "datasets" / "v1").resolve()))]
    assert revision_of(latest_backup(folder)) == "0006"


def test_a_type_already_marked_defect_gets_numbered_findings(app, settings, tmp_path):
    catalogue = ports.open_catalogue_db(settings.data_dir)
    with catalogue.session() as cs:
        crack = ports.create_type(cs, name="Crack", colour="#ef4444", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET kind = 'defect' WHERE id = :id"), {"id": crack})
    catalogue.engine.dispose()
    classes = [{"id": "c-crack", "name": "crack", "colour": "#ef4444", "hotkey": None, "order": 0}]
    folder = at_revision(tmp_path / "bridge", "0009", pid="pbr", name="Bridge", classes=classes)
    add_images_and_boxes(folder, classes=classes)
    _remember(settings, ("pbr", "Bridge", folder))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, folder)
        with app.state.projects.get("pbr").session() as s:
            numbers = list(s.execute(text("SELECT number FROM finding ORDER BY number")).scalars())
            total = s.execute(text("SELECT SUM(n) FROM finding_count")).scalar_one()
    assert numbers == [1, 2, 3] and total == 3


def test_a_new_project_is_born_upgraded(app, client, tmp_path):
    r = client.post("/api/v1/projects", json={"name": "New", "folder": str(tmp_path / "new"), "type_ids": []})
    assert r.status_code == 201, r.text
    assert r.json()["schema_version"] == 2 and r.json()["migration"]["state"] == "ok"
    assert MigrationStates(app.state.settings.data_dir).get(tmp_path / "new") is None
    assert client.get(f"/api/v1/projects/{r.json()['id']}").status_code == 200


def test_a_project_created_while_disarmed_upgrades_as_a_no_op(app, client, tmp_path, monkeypatch):
    """Hand-off 2: a project created between BC and MG-steps is at version 1 with BC's
    `project_type` rows and boxes already on catalogue ids; arming brings it to 2 and changes nothing."""
    real = steps.PIPELINE
    t = client.post("/api/v1/catalogue/types", json={"name": "Loader", "colour": "#22c55e", "hotkey": "4"})
    assert t.status_code == 201, t.text
    type_id = t.json()["id"]
    arm(monkeypatch)  # disarmed
    folder = tmp_path / "between"
    body = {"name": "Between", "folder": str(folder), "type_ids": [type_id]}
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["schema_version"] == 1
    add_images_and_boxes(folder, classes=[{"id": type_id}])
    handle = app.state.projects.get(r.json()["id"])
    with handle.session() as s:
        types_before = s.execute(text("SELECT * FROM project_type ORDER BY position")).all()
    catalogue_before = catalogue_types(app.state.catalogue)
    assert not needs_classification(app.state.catalogue)

    arm(monkeypatch, *real)
    env = MigrationEnv(
        library=app.state.library,
        catalogue=app.state.catalogue,
        origin_folder=folder,
        log=logging.getLogger("test.migration"),
    )
    report = run_pipeline(handle, env, steps.PIPELINE)

    assert report["warnings"] == []
    with handle.session() as s:
        assert s.execute(text("SELECT schema_version FROM project")).scalar_one() == 2
        assert s.execute(text("SELECT COUNT(*) FROM class_id_map")).scalar_one() == 0
        assert s.execute(text("SELECT * FROM project_type ORDER BY position")).all() == types_before
        assert set(s.execute(text("SELECT DISTINCT class_id FROM box")).scalars()) == {type_id}
    assert catalogue_types(app.state.catalogue) == catalogue_before
    assert not needs_classification(app.state.catalogue)


def test_without_the_catalogue_a_legacy_project_waits(app, client, tmp_path, monkeypatch):
    folder = at_revision(tmp_path / "old", "0009")
    monkeypatch.setattr(app.state.jobs, "catalogue", None)
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.json()["migration"]["state"] == "pending" and "catalogue" in r.json()["migration"]["error"]
    g = client.get(f"/api/v1/projects/{r.json()['id']}")
    assert g.status_code == 409 and g.json()["error"]["details"] == {"job_id": None}


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _state(handle, stores) -> dict:
    """Everything the steps write, without timestamps: equal states mean nothing was written twice."""
    with handle.session() as s:
        project = {
            "boxes": sorted(s.execute(text("SELECT id, class_id FROM box")).all()),
            "map": s.execute(text("SELECT counts, area_counts, class_map FROM map_run")).all(),
            "ids": sorted(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all()),
            "types": s.execute(
                text("SELECT type_id, position, hotkey_override FROM project_type ORDER BY position")
            ).all(),
            "findings": s.execute(text("SELECT number, annotation_id FROM finding ORDER BY number")).all(),
            "activity": s.execute(text("SELECT COUNT(*) FROM activity")).scalar_one(),
        }
    with stores.catalogue.session() as cs:
        project["catalogue"] = sorted(cs.execute(text("SELECT id, name, kind FROM catalogue_type")).all())
    with stores.library.session() as ls:
        project["datasets"] = sorted(ls.execute(text("SELECT name, legacy_path FROM dataset")).all())
    return project


def test_every_step_is_idempotent(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    add_dataset(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_pipeline(h, env, steps.PIPELINE)
    after_once = _state(h, stores)
    for step in steps.PIPELINE:
        run_step(h, env, step.run)
    assert _state(h, stores) == after_once


def test_a_crash_between_steps_resumes_without_duplicates(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)

    def crash(ctx):
        raise RuntimeError("the sidecar was killed")

    broken = tuple(Step(s.name, s.label, crash) if s.name == "project_types" else s for s in steps.PIPELINE)
    with pytest.raises(StepFailed) as err:
        run_pipeline(h, env, broken)
    assert err.value.step == "project_types"
    run_pipeline(h, env, steps.PIPELINE)
    assert len(catalogue_types(stores)) == 2
    assert len(_state(h, stores)["ids"]) == 2 and len(_state(h, stores)["types"]) == 2
    with h.session() as s:
        assert s.execute(text("SELECT schema_version FROM project")).scalar_one() == 2
