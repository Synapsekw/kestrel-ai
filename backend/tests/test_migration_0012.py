"""Migration 0012 (spec 2026-09-26-map-workspace §12, unit M-C0): three new tables, the columns M's
units fill, the union's indexes and a best-effort backfill of `surface.captured_on`. A project at the
previous head upgrades with every row it had; old runs read `scope = 'map'` and old site areas
`category = 'general'`; a failing backfill never stops the upgrade.

The previous revision is read from the chain (`0010` while M-C0 builds, `0011` once it is rebased on
I-C0), so a rebase never edits this file.
"""

import importlib.util
import sqlite3
from datetime import date

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from app.db.models import (
    Drawing,
    MapDetection,
    MapMeasurement,
    MapRun,
    MapWorkspace,
    SiteArea,
    Surface,
    VolumeMeasurement,
)
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0012"
NEW_TABLES = {"map_workspace": MapWorkspace, "drawing": Drawing, "map_measurement": MapMeasurement}
WIDENED = {
    "surface": Surface,
    "volume_measurement": VolumeMeasurement,
    "map_run": MapRun,
    "map_detection": MapDetection,
    "site_area": SiteArea,
}
TS = "2026-01-01 00:00:00.000000"


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _previous() -> str:
    return ScriptDirectory.from_config(_cfg()).get_revision(REVISION).down_revision


def _at_previous_with_rows(folder) -> None:
    """A project one revision below 0012 with a map, a run, a detection, a site area, a cloud, its DSM
    and a design surface."""
    folder.mkdir()
    command.upgrade(_cfg(folder), _previous())
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,"
        " band_count, dtype, stretch, labels_version, created_at) VALUES ('m1', 'April', 'ready',"
        " 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0, ?)",
        (TS,),
    )
    con.execute(
        "INSERT INTO map_run (id, map_id, kind, query, tile_size, overlap, nms_iou, conf, counts, created_at)"
        " VALUES ('r1', 'm1', 'local_model', '', 1280, 0.2, 0.5, 0.25, '{}', ?)",
        (TS,),
    )
    con.execute(
        "INSERT INTO map_detection (id, run_id, class_id, confidence, x, y, w, h)"
        " VALUES ('d1', 'r1', 'c1', 0.9, 1, 1, 2, 2)"
    )
    con.execute(
        "INSERT INTO site_area (id, name, polygon_wgs84, created_at)"
        " VALUES ('a1', 'Yard', '[[0,0],[1,0],[1,1]]', ?)",
        (TS,),
    )
    con.execute(
        "INSERT INTO point_cloud (id, name, status, source_path, source_size, captured_on, created_at)"
        " VALUES ('pc1', 'May cloud', 'ready', 'c.las', 1, '2026-05-02', ?)",
        (TS,),
    )
    con.execute(
        "INSERT INTO surface (id, name, kind, status, point_cloud_id, created_at)"
        " VALUES ('s1', 'May DSM', 'cloud_dsm', 'ready', 'pc1', ?)",
        (TS,),
    )
    con.execute(
        "INSERT INTO surface (id, name, kind, status, created_at)"
        " VALUES ('s2', 'Design', 'design', 'ready', ?)",
        (TS,),
    )
    con.commit()
    con.close()


def _load_migration():
    path = MIGRATIONS / "versions" / "0012_map_workspace.py"
    spec = importlib.util.spec_from_file_location("migration_0012", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_chain_has_one_head_and_it_is_this_revision():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    chain = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert REVISION in chain, (heads, sorted(chain))


def test_upgrade_adds_the_tables_columns_and_indexes_the_models_name(tmp_path):
    folder = tmp_path / "old"
    _at_previous_with_rows(folder)
    engine = open_project_db(folder)
    try:
        with engine.connect() as c:
            for table, model in {**NEW_TABLES, **WIDENED}.items():
                cols = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
                assert cols == {col.name for col in model.__table__.columns}, table
            tables = (
                "map_detection",
                "volume_measurement",
                "cloud_measurement",
                "map_measurement",
                "drawing",
            )
            indexes = {t: {r[1]: r[2] for r in c.exec_driver_sql(f"PRAGMA index_list({t})")} for t in tables}
            fks = {(r[3], r[2], r[6]) for r in c.exec_driver_sql("PRAGMA foreign_key_list(map_measurement)")}
    finally:
        engine.dispose()
    assert indexes["map_detection"]["ux_map_detection_finding"] == 1  # unique
    assert "ix_volume_measurement_created" in indexes["volume_measurement"]
    assert "ix_cloud_measurement_created" in indexes["cloud_measurement"]
    assert "ix_map_measurement_created" in indexes["map_measurement"]
    assert {"ix_drawing_status", "ix_drawing_created"} <= set(indexes["drawing"])
    assert fks == {("map_id", "geo_map", "SET NULL")}


def test_existing_rows_get_the_defaults(tmp_path):
    folder = tmp_path / "old"
    _at_previous_with_rows(folder)
    engine = open_project_db(folder)
    try:
        with make_session_factory(engine)() as s:
            run = s.get(MapRun, "r1")
            assert (run.scope, run.region_px) == ("map", None)
            assert s.get(SiteArea, "a1").category == "general"
            assert s.get(MapDetection, "d1").finding_id is None
            assert s.get(Surface, "s1").elevation_role is None
    finally:
        engine.dispose()


def test_the_backfill_dates_a_cloud_dsm_from_its_cloud_and_nothing_else(tmp_path):
    folder = tmp_path / "old"
    _at_previous_with_rows(folder)
    engine = open_project_db(folder)
    try:
        with make_session_factory(engine)() as s:
            assert s.get(Surface, "s1").captured_on == date(2026, 5, 2)
            assert s.get(Surface, "s2").captured_on is None
    finally:
        engine.dispose()


def test_a_failing_backfill_leaves_captured_on_null_and_upgrades(tmp_path):
    folder = tmp_path / "old"
    _at_previous_with_rows(folder)
    con = sqlite3.connect(folder / "project.db")
    con.execute("CREATE TRIGGER no_surface_upd BEFORE UPDATE ON surface BEGIN SELECT RAISE(ABORT, 'no'); END")
    con.commit()
    con.close()
    engine = open_project_db(folder)  # must not raise: the app must start
    try:
        with make_session_factory(engine)() as s:
            assert s.get(Surface, "s1").captured_on is None
            assert s.query(MapWorkspace).count() == 0  # the rest of 0012 ran
        with engine.connect() as c:
            assert c.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == REVISION
    finally:
        engine.dispose()


def test_the_backfill_reports_a_failure_and_the_transaction_goes_on():
    module = _load_migration()
    engine = create_engine("sqlite://")
    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE surface (id TEXT, kind TEXT, point_cloud_id TEXT, captured_on DATE)")
        assert module.backfill_captured_on(c) is False  # no point_cloud table
        c.exec_driver_sql("INSERT INTO surface (id, kind) VALUES ('s', 'cloud_dsm')")
        assert c.exec_driver_sql("SELECT count(*) FROM surface").scalar_one() == 1


def test_downgrade_removes_only_what_0012_added(tmp_path):
    folder = tmp_path / "old"
    _at_previous_with_rows(folder)
    command.upgrade(_cfg(folder), "head")
    command.downgrade(_cfg(folder), _previous())
    con = sqlite3.connect(folder / "project.db")
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        cols = {t: {r[1] for r in con.execute(f"PRAGMA table_info({t})")} for t in WIDENED}
        assert con.execute("SELECT name FROM geo_map").fetchone() == ("April",)
        assert con.execute("SELECT name FROM site_area").fetchone() == ("Yard",)
    finally:
        con.close()
    assert not set(NEW_TABLES) & tables
    assert not {"elevation_role", "captured_on"} & cols["surface"]
    assert "material" not in cols["volume_measurement"]
    assert not {"scope", "region_px"} & cols["map_run"]
    assert "finding_id" not in cols["map_detection"]
    assert "category" not in cols["site_area"]
