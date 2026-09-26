"""The migration's view of other units' schemas (foundation spec §7, §8, §12): every column the
steps write must exist in the merged migrations, or this fails naming app/migration/ports.py."""

import pytest
from migration_helpers import at_revision, open_handle, open_stores
from sqlalchemy import text

from app.migration import ports

PROJECT_TABLES = {
    "class_id_map": ports.CLASS_ID_MAP,
    "project_type": ports.PROJECT_TYPE,
    "finding": ports.FINDING,
    "finding_count": ports.FINDING_COUNT,
    "activity": ports.ACTIVITY,
    "migration_step": ("name", "done_at", "detail"),
}
LIBRARY_TABLES = {
    "library_model": ports.LIBRARY_MODEL,
    "dataset": ports.LIBRARY_DATASET,
    "dataset_source": ports.DATASET_SOURCE,
}
CATALOGUE_TABLES = {"catalogue_type": ports.CATALOGUE_TYPE, "catalogue_meta": ports.CATALOGUE_META}


def _columns(engine, table) -> set[str]:
    with engine.connect() as c:
        return {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}


def _missing(engine, tables) -> dict:
    return {
        t: sorted(set(cols) - _columns(engine, t))
        for t, cols in tables.items()
        if set(cols) - _columns(engine, t)
    }


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def test_the_project_tables_have_the_columns_the_steps_write(tmp_path):
    handle = open_handle(at_revision(tmp_path / "p", "head"))
    try:
        assert _missing(handle.engine, PROJECT_TABLES) == {}, "update app/migration/ports.py"
    finally:
        handle.engine.dispose()


def test_the_library_and_catalogue_tables_have_the_columns_the_steps_write(stores):
    assert _missing(stores.library.engine, LIBRARY_TABLES) == {}, "update app/migration/ports.py"
    assert _missing(stores.catalogue.engine, CATALOGUE_TABLES) == {}, "update app/migration/ports.py"


def test_normalise_name_is_the_spec_rule():
    assert ports.normalise_name("dump_truck") == ports.normalise_name("Dump truck")
    assert ports.normalise_name("  DUMP-truck ") == ports.normalise_name("dump  truck")
    assert ports.normalise_name("crane") != ports.normalise_name("crane 2")


def test_a_catalogue_type_round_trips(stores):
    with stores.catalogue.session() as cs:
        type_id = ports.create_type(cs, name="dump_truck", colour="#06b6d4", hotkey="3")
    with stores.catalogue.session() as cs:
        found = ports.find_type(cs, "Dump Truck")
        assert found["id"] == type_id and found["kind"] == "object"
        assert not ports.hotkey_free(cs, "3") and ports.hotkey_free(cs, "4")
        assert ports.type_rows(cs, [type_id])[type_id]["name"] == "dump_truck"
        name_key = cs.execute(
            text("SELECT name_key FROM catalogue_type WHERE id = :id"), {"id": type_id}
        ).scalar_one()
        assert name_key == ports.normalise_name("dump_truck")


def test_counts_rebuild_and_activity_run_on_an_empty_project(tmp_path):
    handle = open_handle(at_revision(tmp_path / "p", "head"))
    try:
        with handle.session() as s:
            ports.rebuild_counts(s)
            assert (
                ports.add_activity_once(
                    s, kind="job.finished", subject_id="p", summary="Project upgraded", payload={}
                )
                is True
            )
            assert (
                ports.add_activity_once(
                    s, kind="job.finished", subject_id="p", summary="Project upgraded", payload={}
                )
                is False
            )
            assert s.execute(text("SELECT COUNT(*) FROM finding_count")).scalar_one() == 0
    finally:
        handle.engine.dispose()
