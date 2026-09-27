"""Migration 0011 (image inspection spec §7.3, §8.1, §9.3): camera and pose columns on `image`, shape
columns on `box`, `image_summary` seeded from the boxes, and `image_measurement`. A project at 0010
upgrades with every row it had."""

import importlib.util
import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from findings_helpers import insert_box
from sqlalchemy import delete, select

from app.db.models import Box, Image, ImageMeasurement, ImageSummary
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0011"
T = "2026-01-01 00:00:00.000000"
R = "2026-01-02 00:00:00.000000"
TABLES = {"image": Image, "box": Box, "image_summary": ImageSummary, "image_measurement": ImageMeasurement}
# Point clouds read these by name (app/pointclouds/cameras.py:_pose_columns): never rename them.
POSE_COLUMNS = {
    "rel_alt",
    "gimbal_pitch",
    "gimbal_yaw",
    "gimbal_roll",
    "flight_yaw",
    "lrf_distance_m",
    "focal_px",
    "focal_mm",
    "sensor_w_mm",
    "orig_w",
    "orig_h",
    "camera_model",
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _at_0010(folder):
    folder.mkdir()
    command.upgrade(_cfg(folder), "0010")
    con = sqlite3.connect(folder / "project.db")
    con.executemany(
        "INSERT INTO image (id, path, width, height, source_id, group_key, marked_empty, created_at)"
        " VALUES (?, ?, 100, 100, 's1', '', 0, ?)",
        [("i1", "images/a.jpg", T), ("i2", "images/b.jpg", T)],
    )
    con.executemany(
        "INSERT INTO box (id, image_id, class_id, x, y, w, h, angle, confidence, provenance_kind,"
        " review_state, reviewed_at, created_at) VALUES (?, 'i1', 'c1', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("b1", 5, 4, 0, None, "person", "accepted", R, T),
            ("b2", 10, 2, 30, 0.9, "local_model", "unreviewed", None, T),
            ("b3", 3, 3, 0, 0.4, "local_model", "unreviewed", None, T),
            ("b4", 3, 3, 0, 0.95, "local_model", "rejected", R, T),
            ("b5", 2, 2, 0, 0.7, "local_model", "edited", R, T),
        ],
    )
    con.commit()
    con.close()


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "old"
    _at_0010(folder)
    eng = open_project_db(folder)
    yield eng
    eng.dispose()


def _columns(eng, table: str) -> dict[str, int]:
    """column name -> notnull flag"""
    with eng.connect() as c:
        return {r[1]: r[3] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}


def test_the_chain_has_one_head_and_0011_follows_0010():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert script.get_revision(REVISION).down_revision == "0010"
    chain = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert REVISION in chain


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_model_column_exists(engine, table):
    assert {c.name for c in TABLES[table].__table__.columns} <= set(_columns(engine, table))


def test_the_pose_columns_keep_the_spec_names_and_are_nullable(engine):
    cols = _columns(engine, "image")
    assert POSE_COLUMNS <= set(cols)
    assert all(cols[name] == 0 for name in POSE_COLUMNS)


def test_existing_boxes_get_shape_area_and_updated_at(engine):
    with engine.connect() as c:
        rows = {
            r[0]: r[1:]
            for r in c.exec_driver_sql("SELECT id, shape, area_px, updated_at, points, assist FROM box")
        }
    assert rows["b2"][0] == "rbox"
    assert {rows[b][0] for b in ("b1", "b3", "b4", "b5")} == {"box"}
    assert rows["b1"][1] == 20.0 and rows["b2"][1] == 20.0
    assert rows["b1"][2].startswith("2026-01-02")  # reviewed_at wins
    assert rows["b2"][2].startswith("2026-01-01")  # else created_at
    assert all(r[3] is None and r[4] is None for r in rows.values())


def test_image_summary_is_seeded_from_the_boxes(engine):
    with engine.connect() as c:
        rows = {
            r[0]: r[1:]
            for r in c.exec_driver_sql(
                "SELECT image_id, annotation_count, pending_count, max_pending_conf FROM image_summary"
            )
        }
    assert rows == {"i1": (2, 2, 0.9), "i2": (0, 0, None)}


def test_the_new_indexes_exist(engine):
    with engine.connect() as c:
        box = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(box)")}
        meas = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(image_measurement)")}
    assert {"ix_box_image_class", "ix_box_image_review"} <= box
    assert "ix_image_measurement_image" in meas


def test_an_upgraded_image_has_the_default_footprint_kind_and_metadata_version(engine):
    with engine.connect() as c:
        row = c.exec_driver_sql("SELECT footprint_kind, metadata_version, footprint FROM image WHERE id='i1'")
        assert row.one() == ("none", 0, None)


def test_deleting_images_cascades_to_summary_and_measurements(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(ImageMeasurement(image_id="i1", x1=0, y1=0, x2=10, y2=10, label="crack"))
        s.commit()
    with factory() as s:  # what datasets/images.bulk_delete does
        s.execute(delete(Box).where(Box.image_id.in_(["i1"])))
        s.execute(delete(Image).where(Image.id.in_(["i1"])))
        s.commit()
    with factory() as s:
        assert s.scalars(select(ImageSummary.image_id)).all() == ["i2"]
        assert s.scalars(select(ImageMeasurement.id)).all() == []


def test_a_new_box_gets_its_area_shape_and_updated_at_from_the_orm(handle, project):
    image_id, box_id = insert_box(handle, project["classes"][0]["id"])
    with handle.session() as s:
        row = s.get(Box, box_id)
        assert row.shape == "box"
        assert row.area_px == pytest.approx(0.1 * 0.1)
        assert row.updated_at is not None
        assert row.points is None and row.assist is None


def test_0011_downgrades_to_0010(tmp_path):
    folder = tmp_path / "down"
    _at_0010(folder)
    open_project_db(folder).dispose()
    command.downgrade(_cfg(folder), "0010")
    con = sqlite3.connect(folder / "project.db")
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        box_cols = {r[1] for r in con.execute("PRAGMA table_info(box)")}
        image_cols = {r[1] for r in con.execute("PRAGMA table_info(image)")}
    finally:
        con.close()
    assert "image_summary" not in tables and "image_measurement" not in tables
    assert not {"shape", "points", "assist", "area_px", "updated_at"} & box_cols
    assert not POSE_COLUMNS & image_cols


def test_0011_does_not_import_the_models():
    path = MIGRATIONS / "versions" / "0011_images.py"
    assert "from app.db" not in path.read_text(encoding="utf-8")
    spec = importlib.util.spec_from_file_location("rev_0011", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert (module.revision, module.down_revision) == ("0011", "0010")
