"""Migration 0009 (foundation F0): the four tables of the point-cloud, volumes and design specs.

A project at 0008 with a map upgrades without any row being rewritten; the foreign keys carry the
actions the specs name, and every model column exists in the migrated table.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.models import CloudMeasurement, GeoMap, PointCloud, Surface, VolumeMeasurement
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0009"
TABLES = {
    "point_cloud": PointCloud,
    "cloud_measurement": CloudMeasurement,
    "surface": Surface,
    "volume_measurement": VolumeMeasurement,
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _at_0008_with_a_map(folder):
    folder.mkdir()
    command.upgrade(_cfg(folder), "0008")
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,"
        " band_count, dtype, stretch, labels_version, created_at) VALUES ('m1', 'April', 'ready',"
        " 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0, '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()


def _opened(tmp_path):
    folder = tmp_path / "old"
    _at_0008_with_a_map(folder)
    return open_project_db(folder)


def test_the_chain_has_one_head_and_it_is_this_revision():
    """One head (two would stop every project opening), and 0009 is on its chain - so a later,
    unrelated migration on top of it does not have to edit this test."""
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    chain = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert REVISION in chain, (heads, sorted(chain))


def test_upgrade_keeps_the_map_and_adds_the_four_tables(tmp_path):
    engine = _opened(tmp_path)
    try:
        with engine.connect() as c:
            tables = {r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
            for table, model in TABLES.items():
                cols = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
                assert cols == {col.name for col in model.__table__.columns}, table
        with make_session_factory(engine)() as s:
            assert s.get(GeoMap, "m1").name == "April"
    finally:
        engine.dispose()
    assert set(TABLES) <= tables


def test_foreign_keys_carry_the_spec_actions(tmp_path):
    engine = _opened(tmp_path)
    try:
        with engine.connect() as c:

            def fks(table):
                return {(r[3], r[2], r[6]) for r in c.exec_driver_sql(f"PRAGMA foreign_key_list({table})")}

            assert fks("point_cloud") == {("map_id", "geo_map", "SET NULL")}
            assert fks("cloud_measurement") == {("point_cloud_id", "point_cloud", "CASCADE")}
            assert fks("surface") == {("point_cloud_id", "point_cloud", "SET NULL")}
            assert fks("volume_measurement") == {("top_surface_id", "surface", "RESTRICT")}
            indexes = {
                table: {r[1] for r in c.exec_driver_sql(f"PRAGMA index_list({table})")}
                for table in ("cloud_measurement", "surface", "volume_measurement")
            }
    finally:
        engine.dispose()
    assert "ix_cloud_measurement_cloud" in indexes["cloud_measurement"]
    assert "ix_surface_status" in indexes["surface"]
    assert "ix_volume_measurement_top_surface" in indexes["volume_measurement"]


def test_the_delete_rules_hold_with_foreign_keys_on(tmp_path):
    engine = _opened(tmp_path)
    factory = make_session_factory(engine)
    try:
        with factory() as s:
            cloud = PointCloud(name="c", source_path="c.las", source_size=1, map_id="m1")
            s.add(cloud)
            s.flush()
            s.add(CloudMeasurement(point_cloud_id=cloud.id, kind="point", name="Point 1", points=[]))
            surface = Surface(name="s", kind="cloud_dsm", point_cloud_id=cloud.id)
            s.add(surface)
            s.flush()
            s.add(
                VolumeMeasurement(
                    name="v", polygon_native=[], top_surface_id=surface.id, base={"kind": "toe_plane"}
                )
            )
            s.commit()
            cloud_id, surface_id = cloud.id, surface.id
        with engine.begin() as c:
            c.exec_driver_sql("DELETE FROM geo_map WHERE id = 'm1'")  # SET NULL on the cloud's link
            assert c.exec_driver_sql("SELECT map_id FROM point_cloud").scalar_one() is None
            c.exec_driver_sql(f"DELETE FROM point_cloud WHERE id = '{cloud_id}'")
            assert c.exec_driver_sql("SELECT count(*) FROM cloud_measurement").scalar_one() == 0  # CASCADE
            assert c.exec_driver_sql("SELECT point_cloud_id FROM surface").scalar_one() is None  # SET NULL
        with pytest.raises(IntegrityError):  # RESTRICT: a surface in use cannot go
            with engine.begin() as c:
                c.exec_driver_sql(f"DELETE FROM surface WHERE id = '{surface_id}'")
    finally:
        engine.dispose()


def test_downgrade_to_0008_removes_only_the_new_tables(tmp_path):
    folder = tmp_path / "old"
    _at_0008_with_a_map(folder)
    command.upgrade(_cfg(folder), "head")
    command.downgrade(_cfg(folder), "0008")
    con = sqlite3.connect(folder / "project.db")
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert con.execute("SELECT name FROM geo_map").fetchone() == ("April",)
    finally:
        con.close()
    assert not set(TABLES) & tables
