"""Migration 0008 (detection workspace): only new nullable or defaulted columns and new tables.

A project at 0007 with a map run and its detections upgrades without any row being rewritten.
"""

import sqlite3

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.db.models import GeoMap, MapDetection, MapRun, ModelClassMap, QueryRun, SiteArea, Source
from app.db.session import MIGRATIONS, make_session_factory, open_project_db


def _at_0007(folder):
    folder.mkdir()
    url = f"sqlite:///{(folder / 'project.db').as_posix()}"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "0007")
    con = sqlite3.connect(folder / "project.db")
    con.executescript(
        """
        INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,
            band_count, dtype, stretch, labels_version, created_at)
          VALUES ('m1', 'April', 'ready', 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0,
                  '2026-01-01 00:00:00.000000');
        INSERT INTO map_run (id, map_id, kind, query, tile_size, overlap, nms_iou, conf, counts, created_at)
          VALUES ('r1', 'm1', 'local_model', '', 1280, 0.2, 0.5, 0.25, '{"c1": 2}',
                  '2026-01-02 00:00:00.000000');
        INSERT INTO map_detection (id, run_id, class_id, confidence, x, y, w, h)
          VALUES ('d1', 'r1', 'c1', 0.9, 1, 2, 3, 4), ('d2', 'r1', 'c1', 0.8, 5, 6, 3, 4);
        INSERT INTO query_run (id, kind, query, image_ids, tiling, conf, created_at)
          VALUES ('q1', 'local_model', '', '[]', '{}', 0.25, '2026-01-02 00:00:00.000000');
        """
    )
    con.commit()
    con.close()


def test_migration_0008_upgrades_a_project_with_a_map_run(tmp_path):
    folder = tmp_path / "old"
    _at_0007(folder)

    engine = open_project_db(folder)
    try:
        # A source inserted the way an old writer would (no kind) still defaults to images.
        with engine.begin() as c:
            c.exec_driver_sql(
                "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at)"
                " VALUES ('s1', 'f', 'site', '{}', 0, 0, '2026-01-03 00:00:00.000000')"
            )
            indexes = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(map_detection)")}
        with make_session_factory(engine)() as s:
            det = s.get(MapDetection, "d1")
            assert det.review_state == "unreviewed"
            assert det.provenance_kind == "local_model"
            run = s.get(MapRun, "r1")
            assert run.counts == {"c1": 2}
            assert run.verified_counts == {}
            assert run.area_counts == {}
            assert run.class_map == {}
            assert run.model_snapshot == {}
            assert run.pinned is False
            assert run.source_id is None
            q = s.get(QueryRun, "q1")
            assert q.counts == {} and q.verified_counts == {} and q.pinned is False
            assert q.source_id is None and q.class_map == {} and q.model_snapshot == {}
            src = s.get(Source, "s1")
            assert src.kind == "images"
            assert src.label is None and src.captured_on is None
            assert s.get(GeoMap, "m1").source_id is None
            assert s.execute(select(SiteArea)).first() is None
            assert s.execute(select(ModelClassMap)).first() is None
    finally:
        engine.dispose()
    assert "ix_map_detection_run_state" in indexes


def test_new_tables_and_links_round_trip(tmp_path):
    folder = tmp_path / "new"
    folder.mkdir()
    engine = open_project_db(folder)
    try:
        factory = make_session_factory(engine)
        with factory() as s, s.begin():
            src = Source(folder="f", site="site", kind="map", label="Flight 14 Sep")
            s.add(src)
            s.flush()
            s.add(GeoMap(id="m1", name="m", source_path="x", source_size=1, source_id=src.id))
            s.add(SiteArea(id="a1", name="Yard", polygon_wgs84=[[15.0, 45.0], [15.1, 45.0], [15.1, 45.1]]))
            s.add(ModelClassMap(library_model_id="lib1", mapping={"truck": "c1", "cone": None}))
        with factory() as s:
            assert s.get(GeoMap, "m1").source_id == src.id
            assert s.get(SiteArea, "a1").polygon_wgs84[2] == [15.1, 45.1]
            assert s.get(SiteArea, "a1").created_at is not None
            assert s.get(ModelClassMap, "lib1").mapping == {"truck": "c1", "cone": None}
        # Deleting the source leaves the map, unlinked (ON DELETE SET NULL).
        with factory() as s, s.begin():
            s.delete(s.get(Source, src.id))
        with factory() as s:
            assert s.get(GeoMap, "m1").source_id is None
    finally:
        engine.dispose()


def test_downgrade_to_0007_keeps_maps_runs_and_detections(tmp_path):
    """Every column goes by plain DROP COLUMN; no table is rebuilt, so nothing cascades away."""
    folder = tmp_path / "down"
    _at_0007(folder)
    engine = open_project_db(folder)  # to head, with PRAGMA foreign_keys=ON
    try:
        cfg = Config(str(MIGRATIONS / "alembic.ini"))
        cfg.set_main_option("script_location", str(MIGRATIONS))
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0007")
        with engine.connect() as c:
            assert c.exec_driver_sql("SELECT COUNT(*) FROM map_detection").scalar_one() == 2
            assert c.exec_driver_sql("SELECT counts FROM map_run").scalar_one() == '{"c1": 2}'
            geo_cols = {r[1] for r in c.exec_driver_sql("PRAGMA table_info(geo_map)")}
            tables = {r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        engine.dispose()
    assert "source_id" not in geo_cols
    assert not {"site_area", "model_class_map"} & tables
