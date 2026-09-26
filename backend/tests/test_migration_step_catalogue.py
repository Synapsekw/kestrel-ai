"""Step 1: classes merge into the catalogue by name, as migrated object types (spec §11.4, F4)."""

import threading
import time

import pytest
from migration_helpers import (
    at_revision,
    catalogue_types,
    class_id_map,
    env_for,
    needs_classification,
    needs_classification_count,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import ports, steps
from app.migration.ports import MigrationBlocked


def _class(cid, name, colour="#06b6d4", hotkey=None, order=0):
    return {"id": cid, "name": name, "colour": colour, "hotkey": hotkey, "order": order}


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _project(tmp_path, name, classes):
    return open_handle(at_revision(tmp_path / name, "0009", pid=f"p-{name}", name=name, classes=classes))


def test_classes_merge_by_name_across_projects(tmp_path, stores):
    a = _project(tmp_path, "a", [_class("a-dump", "dump_truck", "#06b6d4", "2")])
    b_classes = [_class("b-dump", "Dump truck", "#ff0000"), _class("b-crane", "crane", "#3b82f6", "2", 1)]
    b = _project(tmp_path, "b", b_classes)
    da = run_step(a, env_for(stores, a.folder), steps.catalogue_merge)
    assert needs_classification_count(stores) == 1
    db_ = run_step(b, env_for(stores, b.folder), steps.catalogue_merge)
    assert (da["types_created"], da["types_merged"]) == (1, 0)
    assert (db_["types_created"], db_["types_merged"]) == (1, 1)
    assert needs_classification_count(stores) == 2
    types = catalogue_types(stores)
    assert set(types) == {"dump_truck", "crane"}
    assert types["dump_truck"]["colour"] == "#06b6d4"  # the first project's colour wins
    assert all(t["kind"] == "object" and t["origin"] == "migrated" for t in types.values())
    assert types["dump_truck"]["hotkey"] == "2" and types["crane"]["hotkey"] is None  # "2" was taken
    assert class_id_map(a) == {"a-dump": types["dump_truck"]["id"]}
    assert class_id_map(b) == {"b-dump": types["dump_truck"]["id"], "b-crane": types["crane"]["id"]}
    assert needs_classification(stores)


def test_an_existing_defect_type_absorbs_the_class_and_keeps_its_kind(tmp_path, stores):
    with stores.catalogue.session() as cs:
        crack = ports.create_type(cs, name="Crack", colour="#ef4444", hotkey="c")
        cs.execute(
            text("UPDATE catalogue_type SET kind = 'defect', origin = 'user' WHERE id = :id"), {"id": crack}
        )
    p = _project(tmp_path, "p", [_class("c-crack", "crack")])
    detail = run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert detail["types_created"] == 0 and class_id_map(p) == {"c-crack": crack}
    assert catalogue_types(stores)["Crack"]["kind"] == "defect"
    assert not needs_classification(stores)  # nothing new to classify


def test_two_spellings_in_one_project_become_one_type(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("old", "Dump truck"), _class("new", "dump_truck", order=1)])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert len(catalogue_types(stores)) == 1
    ids = class_id_map(p)
    assert ids["old"] == ids["new"]


def test_an_archived_match_does_not_absorb_the_class(tmp_path, stores):
    with stores.catalogue.session() as cs:
        old = ports.create_type(cs, name="crane", colour="#3b82f6", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET archived = 1 WHERE id = :id"), {"id": old})
    p = _project(tmp_path, "p", [_class("c-crane", "crane")])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert class_id_map(p)["c-crane"] != old


def test_a_rerun_creates_nothing_and_keeps_the_ids(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("c1", "excavator"), _class("c2", "roller", order=1)])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    first = class_id_map(p)
    again = run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert (again["types_created"], again["types_merged"]) == (0, 2)
    assert class_id_map(p) == first and len(catalogue_types(stores)) == 2


def test_without_the_catalogue_the_step_is_blocked(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("c1", "excavator")])
    env = env_for(stores, p.folder)
    env.catalogue = None
    with pytest.raises(MigrationBlocked, match="catalogue"):
        run_step(p, env, steps.catalogue_merge)


def test_two_projects_merging_at_once_create_one_type(tmp_path, stores, monkeypatch):
    a = _project(tmp_path, "a", [_class("a-dump", "dump_truck")])
    b = _project(tmp_path, "b", [_class("b-dump", "Dump truck")])
    real_find = ports.find_type

    def slow_find(cs, name):  # widen the window between "not found" and "create"
        found = real_find(cs, name)
        time.sleep(0.2)
        return found

    monkeypatch.setattr(ports, "find_type", slow_find)
    errors = []

    def merge(h):
        try:
            run_step(h, env_for(stores, h.folder), steps.catalogue_merge)
        except Exception as e:  # noqa: BLE001 - the assertion below reports it
            errors.append(e)

    threads = [threading.Thread(target=merge, args=(h,)) for h in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [] and len(catalogue_types(stores)) == 1
    assert class_id_map(a)["a-dump"] == class_id_map(b)["b-dump"]


def test_project_type_rows_written_by_create_are_left_alone(tmp_path, stores):
    """A v1 project may already carry `project_type` rows written by BC's `create` (hand-off 1):
    `.classes` would append them after the legacy list, but the step must read only
    `legacy_classes`, so it maps just the old class and writes no `class_id_map` row for the
    project_type's type id."""
    p = _project(tmp_path, "p", [_class("c1", "excavator")])
    with p.session() as s:
        ports.insert_project_type(
            s,
            type_id="already-created-type",
            position=1,
            hotkey_override=None,
            snapshot={
                "name": "crane",
                "colour": "#3b82f6",
                "kind": "object",
                "default_severity": None,
                "hotkey": None,
                "group": None,
            },
        )
    detail = run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert detail["types_created"] == 1 and detail["created"] == ["excavator"]
    ids = class_id_map(p)
    assert set(ids) == {"c1"}
    assert "already-created-type" not in ids.values()
    assert "crane" not in catalogue_types(stores)
