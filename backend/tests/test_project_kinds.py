"""Project kinds (spec 2026-09-23 section 5): the column, the create body, the recent list and the guard."""

import json
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from conftest import COLOURS, EIGHT_CLASSES
from fastapi.routing import APIRoute

from app.db.session import MIGRATIONS, open_project_db
from app.projects.kinds import ANY_KIND, KIND_ATTR, require_kind

BASE = "/api/v1/projects"
CLASSES = [{"name": n, "colour": c} for n, c in zip(EIGHT_CLASSES[:2], COLOURS[:2], strict=True)]


def _create(client, folder: Path, kind: str | None) -> dict:
    body = {"name": f"P-{kind}", "folder": str(folder), "classes": CLASSES}
    if kind is not None:
        body["kind"] = kind
    return client.post(BASE, json=body)


# --- migration -----------------------------------------------------------------------------------


def test_migration_0006_marks_existing_projects_train_and_adds_model_adoption(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    url = f"sqlite:///{(folder / 'project.db').as_posix()}"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "0005")
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO project (id, name, classes, schema_version, import_defaults, created_at)"
        " VALUES ('p1', 'Old', '[]', 1, '{}', '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()

    engine = open_project_db(folder)
    try:
        with engine.connect() as c:
            assert c.exec_driver_sql("SELECT kind FROM project").scalar_one() == "train"
            cols = {r[1] for r in c.exec_driver_sql("PRAGMA table_info(model_adoption)")}
    finally:
        engine.dispose()
    assert {"old_model_id", "library_model_id", "status", "error", "updated_at"} <= cols


# --- create, list, recent ------------------------------------------------------------------------


def test_create_without_kind_is_422(client, tmp_path):
    r = _create(client, tmp_path / "a", None)
    assert r.status_code == 422, r.text


def test_create_with_unknown_kind_is_422(client, tmp_path):
    r = _create(client, tmp_path / "a", "survey")
    assert r.status_code == 422, r.text


def test_create_detect_project_reports_its_kind_everywhere(client, settings, tmp_path):
    r = _create(client, tmp_path / "d", "detect")
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["kind"] == "detect"
    assert client.get(f"{BASE}/{created['id']}").json()["kind"] == "detect"
    listed = {p["id"]: p["kind"] for p in client.get(BASE).json()["items"]}
    assert listed[created["id"]] == "detect"
    recent = json.loads((settings.data_dir / "recent_projects.json").read_text("utf-8"))
    assert recent[0]["id"] == created["id"]
    assert recent[0]["kind"] == "detect"


def test_opening_a_project_remembers_its_kind(client, settings, tmp_path):
    folder = tmp_path / "d"
    pid = _create(client, folder, "detect").json()["id"]
    client.delete(f"{BASE}/{pid}")
    r = client.post(f"{BASE}/open", json={"folder": str(folder)})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "detect"
    recent = json.loads((settings.data_dir / "recent_projects.json").read_text("utf-8"))
    assert recent[0]["kind"] == "detect"


def test_kind_cannot_be_patched(client, tmp_path):
    pid = _create(client, tmp_path / "t", "train").json()["id"]
    r = client.patch(f"{BASE}/{pid}", json={"kind": "detect"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "train"


# --- the guard -----------------------------------------------------------------------------------


def _error(r) -> dict:
    return r.json()["error"]


def test_detect_project_refuses_training_work(client, tmp_path):
    pid = _create(client, tmp_path / "d", "detect").json()["id"]
    r = client.post(f"{BASE}/{pid}/datasets", json={"name": "ds", "split": {"train": 0.8, "val": 0.2}})
    assert r.status_code == 409, r.text
    err = _error(r)
    assert err["code"] == "wrong_project_kind"
    assert err["details"] == {"kind": "detect", "allowed": ["train"]}
    assert client.get(f"{BASE}/{pid}/datasets").status_code == 409

    r = client.post(f"{BASE}/{pid}/images/nope/preannotate", json={})
    assert r.status_code == 409, r.text
    assert _error(r)["code"] == "wrong_project_kind"

    r = client.get(f"{BASE}/{pid}/agent")
    assert r.status_code == 409, r.text


def test_detect_project_shares_image_storage_and_jobs(client, tmp_path):
    pid = _create(client, tmp_path / "d", "detect").json()["id"]
    assert client.get(f"{BASE}/{pid}/images").status_code == 200
    assert client.get(f"{BASE}/{pid}/sources").status_code == 200
    assert client.get(f"{BASE}/{pid}/jobs").status_code == 200
    assert client.get(f"{BASE}/{pid}/stats").status_code == 200
    assert client.get(f"{BASE}/{pid}/maps").status_code == 200
    assert client.get(f"{BASE}/{pid}/query-runs").status_code == 200


def test_train_project_keeps_past_maps_read_only(client, tmp_path):
    pid = _create(client, tmp_path / "t", "train").json()["id"]
    r = client.post(f"{BASE}/{pid}/maps", json={"path": str(tmp_path / "x.tif")})
    assert r.status_code == 409, r.text
    assert _error(r)["code"] == "wrong_project_kind"
    assert _error(r)["details"] == {"kind": "train", "allowed": ["detect"]}
    assert client.get(f"{BASE}/{pid}/maps").status_code == 200


def test_train_project_still_labels_with_query_runs(client, tmp_path):
    """Deviation from the plan's kind table (reported): the project agent and the setup flow label a
    training project's images through query runs, so query runs serve both kinds until the plan
    gives training projects another labelling path."""
    pid = _create(client, tmp_path / "t", "train").json()["id"]
    r = client.post(
        f"{BASE}/{pid}/query-runs", json={"kind": "local_model", "image_ids": ["x"], "model_id": "m"}
    )
    # The guard lets it through to the route, which rejects the unknown image on its own terms.
    assert r.status_code == 404, r.text
    assert _error(r)["code"] == "not_found", r.text
    assert client.get(f"{BASE}/{pid}/query-runs").status_code == 200


def test_unknown_project_is_still_404(client):
    assert client.get(f"{BASE}/nope/datasets").status_code == 404
    assert client.post(f"{BASE}/nope/query-runs", json={}).status_code == 404


# --- the table is complete -----------------------------------------------------------------------


def _kind_rules(dependant) -> list:
    found = []
    for dep in dependant.dependencies:
        rule = getattr(dep.call, KIND_ATTR, None)
        if rule is not None:
            found.append(rule)
        found.extend(_kind_rules(dep))
    return found


def test_every_project_route_declares_its_kinds(app):
    unguarded = sorted(
        f"{','.join(sorted(r.methods))} {r.path}"
        for r in app.routes
        if isinstance(r, APIRoute)
        and r.path.startswith("/api/v1/projects/{projectId}")
        and not _kind_rules(r.dependant)
    )
    assert not unguarded, "project routes with no require_kind:\n" + "\n".join(unguarded)


def test_training_route_is_train_only_once_it_exists(app):
    """BL's `/projects/{id}/train` moves out of `/models`; whichever path it has, it is train-only."""
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path == "/api/v1/projects/{projectId}/train":
            assert (("train",), ("train",)) in _kind_rules(r.dependant), r.path


def test_require_kind_carries_its_rule():
    dep = require_kind(("detect",), ANY_KIND)
    assert getattr(dep, KIND_ATTR) == (("detect",), ANY_KIND)
    dep = require_kind(("train",))
    assert getattr(dep, KIND_ATTR) == (("train",), ("train",))
