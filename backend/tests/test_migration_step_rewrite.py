"""Step 2: class ids become catalogue type ids on every table and JSON shape (spec §11.4, §16)."""

import json

import pytest
from migration_helpers import (
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    at_revision,
    catalogue_types,
    db,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import ports, steps
from app.migration.invariants import compare, snapshot


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _one(handle, sql):
    with handle.session() as s:
        return s.execute(text(sql)).one()


def test_every_table_and_json_shape_points_at_type_ids(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    add_dataset(folder)
    before = snapshot(folder / "project.db")
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    detail = run_step(h, env, steps.rewrite_class_ids)
    ids = {name: row["id"] for name, row in catalogue_types(stores).items()}
    exc, dump = ids["excavator"], ids["dump_truck"]
    assert detail["rows_rewritten"] == {"box": 10, "map_detection": 4, "map_label": 1}
    with h.session() as s:
        assert set(s.execute(text("SELECT DISTINCT class_id FROM box")).scalars()) == {exc, dump}
        assert set(s.execute(text("SELECT DISTINCT class_id FROM map_detection")).scalars()) == {exc, dump}
    counts, verified, area, class_map = (
        json.loads(v) for v in _one(h, "SELECT counts, verified_counts, area_counts, class_map FROM map_run")
    )
    assert counts == {exc: 3, dump: 1} and verified == {exc: 1}
    assert area == {"area1": {exc: {"total": 2, "verified": 1}, dump: {"total": 1, "verified": 0}}}
    assert class_map == {"excavator": exc, "truck": dump, "person": None}
    q_counts, q_map = (json.loads(v) for v in _one(h, "SELECT counts, class_map FROM query_run"))
    assert q_counts == {exc: 2} and q_map == {"excavator": exc}
    assert json.loads(_one(h, "SELECT mapping FROM model_class_map")[0]) == {
        "excavator": exc,
        "truck": dump,
        "bird": None,
    }
    assert [c["id"] for c in json.loads(_one(h, "SELECT classes FROM dataset")[0])] == [exc, dump]
    frozen = json.loads(_one(h, "SELECT boxes FROM dataset_image")[0])
    assert {b["class_id"] for b in frozen} == {"c-exc", "c-dump"}  # spec: not rewritten
    h.engine.dispose()
    assert compare(before, snapshot(folder / "project.db")) == []


def test_a_box_on_a_deleted_class_keeps_its_id_and_is_reported(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    with db(folder) as con:
        con.execute("UPDATE box SET class_id = 'c-deleted' WHERE id = 'b-c-exc-0'")
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    detail = run_step(h, env, steps.rewrite_class_ids)
    assert detail["rows_rewritten"]["box"] == 9
    assert any(w.startswith("box: 1 row(s)") for w in detail["warnings"])
    with h.session() as s:
        assert s.execute(text("SELECT class_id FROM box WHERE id = 'b-c-exc-0'")).scalar_one() == "c-deleted"


def test_a_rerun_rewrites_nothing(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    run_step(h, env, steps.rewrite_class_ids)
    first = _one(h, "SELECT counts, area_counts FROM map_run")
    again = run_step(h, env, steps.rewrite_class_ids)
    assert again["rows_rewritten"] == {"box": 0, "map_detection": 0, "map_label": 0}
    assert _one(h, "SELECT counts, area_counts FROM map_run") == first


def test_a_box_on_a_bc_era_project_type_is_not_reported_as_an_orphan(tmp_path, stores):
    """Controller ruling: a v1 project may already carry a `project_type` row (BC-era `create`).
    A box on that row's type id is not in `class_id_map` (step 1 never touches project_type ids),
    but it is a real, live catalogue type in the project, so it must not be warned about."""
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    h = open_handle(folder)
    with h.session() as s:
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
    with db(folder) as con:
        con.execute("UPDATE box SET class_id = 'already-created-type' WHERE id = 'b-c-exc-0'")
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    detail = run_step(h, env, steps.rewrite_class_ids)
    assert detail["warnings"] == []
    with h.session() as s:
        assert (
            s.execute(text("SELECT class_id FROM box WHERE id = 'b-c-exc-0'")).scalar_one()
            == "already-created-type"
        )
