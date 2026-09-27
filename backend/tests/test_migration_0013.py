"""Migration 0013 (spec 2026-09-26-point-cloud-workspace sections 8.1, 10.1, 11.2): the cloud
measurement columns, `cloud_camera_offset` and `cloud_view`. A project at the previous head upgrades
with every measurement `ready`; the foreign keys and the view CHECK hold with foreign_keys=ON."""

import importlib.util
import json
import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    CLOUD_VIEW_SUBJECT_CHECK,
    CloudCameraOffset,
    CloudMeasurement,
    CloudView,
    Finding,
    PointCloud,
    Source,
)
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0013"
PATH = MIGRATIONS / "versions" / "0013_cloud_workspace.py"
TABLES = {
    "cloud_measurement": CloudMeasurement,
    "cloud_camera_offset": CloudCameraOffset,
    "cloud_view": CloudView,
}
NEW_COLUMNS = ("params", "status", "error", "job_id", "finding_id")


def _module():
    spec = importlib.util.spec_from_file_location("rev_0013", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DOWN = _module().down_revision


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _columns(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # head, with PRAGMA foreign_keys=ON
    yield eng
    eng.dispose()


@pytest.fixture
def factory(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(PointCloud(id="c1", name="C", status="ready", source_path="C:/c.las", source_size=1))
        s.add(Source(id="s1", folder="C:/f", site="S"))
        s.add(
            Finding(
                id="f1",
                number=1,
                type_id="t1",
                status="open",
                note="",
                created_by="human",
                anchor_kind="cloud",
                cloud_id="c1",
                x=0.0,
                y=0.0,
                z=0.0,
                data_type="point_cloud",
                data_id="c1",
            )
        )
        # Flush before the dependent insert: SQLAlchemy does not order cross-table inserts by their
        # raw (non-relationship()) foreign keys within one flush (see test_migration_0009.py's own
        # s.flush() between PointCloud and CloudMeasurement for the same reason).
        s.flush()
        s.add(
            CloudMeasurement(
                id="m1",
                point_cloud_id="c1",
                kind="distance",
                name="D 1",
                points=[],
                results={},
                finding_id="f1",
            )
        )
        s.commit()
    return factory


def _view(**kw) -> CloudView:
    base = dict(
        point_cloud_id="c1",
        pose={"position": [0, 0, 0], "target": [0, 1, 0], "up": [0, 0, 1], "fov_deg": 50},
        render={},
        path="pointclouds/c1/views/finding-f1.png",
        sha256="0" * 64,
        bytes=1,
        width=1600,
        height=1000,
        anchor_hash="0" * 64,
    )
    return CloudView(**{**base, **kw})


def test_the_chain_has_one_head_and_0013_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}


def test_0013_sits_on_m_which_sits_on_i():
    """R4: 0010 (F) <- 0011 (I) <- 0012 (M) <- 0013 (C). The ids of I and M are read, not assumed."""
    script = ScriptDirectory.from_config(_cfg())
    m = script.get_revision(DOWN)
    i = script.get_revision(m.down_revision)
    assert i.down_revision == "0010", (i.revision, i.down_revision)


def test_a_project_at_the_previous_head_upgrades_with_every_measurement_ready(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    command.upgrade(_cfg(folder), DOWN)
    points = [
        {"x": 0, "y": 0, "z": 0, "uncertainty_m": 0.01},
        {"x": 3, "y": 4, "z": 0, "uncertainty_m": 0.01},
    ]
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)"
        " VALUES ('c1', 'C', 'ready', 'C:/c.las', 1, '2026-01-01 00:00:00.000000')"
    )
    con.execute(
        "INSERT INTO cloud_measurement (id, point_cloud_id, kind, name, points, results, created_at,"
        " updated_at)"
        " VALUES ('m1', 'c1', 'distance', 'Distance 1', ?, '{\"distance_3d\": 5.0}',"
        " '2026-01-01 00:00:00.000000', '2026-01-01 00:00:00.000000')",
        (json.dumps(points),),
    )
    con.commit()
    con.close()

    command.upgrade(_cfg(folder), REVISION)

    con = sqlite3.connect(folder / "project.db")
    try:
        row = con.execute(
            "SELECT name, points, status, params, error, job_id, finding_id FROM cloud_measurement"
        ).fetchall()
        assert len(row) == 1
        name, stored, status, params, error, job_id, finding_id = row[0]
        assert (name, json.loads(stored)) == ("Distance 1", points)
        assert (status, params, error, job_id, finding_id) == ("ready", None, None, None, None)
        indexes = {r[1] for r in con.execute("PRAGMA index_list(cloud_measurement)")}
        assert {
            "ix_cloud_measurement_cloud",
            "ix_cloud_measurement_created",
            "ix_cloud_measurement_finding",
        } <= indexes
        assert {"cloud_camera_offset", "cloud_view"} <= _tables(con)
    finally:
        con.close()


def test_0013_downgrades_to_the_previous_head(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    command.upgrade(_cfg(folder), REVISION)
    command.downgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert not {"cloud_camera_offset", "cloud_view"} & _tables(con)
        assert not set(NEW_COLUMNS) & _columns(con, "cloud_measurement")
        assert "ix_cloud_measurement_created" in {
            r[1] for r in con.execute("PRAGMA index_list(cloud_measurement)")
        }
    finally:
        con.close()


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_model_column_exists(engine, table):
    with engine.connect() as c:
        have = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
    assert {col.name for col in TABLES[table].__table__.columns} <= have


def test_a_new_measurement_defaults_to_ready(factory):
    with factory() as s:
        s.add(CloudMeasurement(id="m2", point_cloud_id="c1", kind="point", name="P 1", points=[], results={}))
        s.commit()
    with factory() as s:
        m = s.get(CloudMeasurement, "m2")
        assert (m.status, m.params, m.finding_id) == ("ready", None, None)


def test_deleting_a_finding_unlinks_its_measurement_and_drops_its_view(factory):
    with factory() as s:
        s.add(_view(id="v1", finding_id="f1", anchor_normal=[0.0, 1.0, 0.0]))
        s.add(_view(id="v2", cloud_measurement_id="m1", path="pointclouds/c1/views/cloud_measurement-m1.png"))
        s.commit()
    with factory() as s:
        s.delete(s.get(Finding, "f1"))
        s.commit()
    with factory() as s:
        assert s.get(CloudMeasurement, "m1").finding_id is None  # ON DELETE SET NULL
        assert s.get(CloudView, "v1") is None  # ON DELETE CASCADE
        assert s.get(CloudView, "v2") is not None


def test_deleting_a_measurement_drops_its_view(factory):
    with factory() as s:
        s.add(_view(id="v2", cloud_measurement_id="m1"))
        s.commit()
    with factory() as s:
        s.delete(s.get(CloudMeasurement, "m1"))
        s.commit()
    with factory() as s:
        assert s.get(CloudView, "v2") is None


def test_deleting_a_cloud_or_a_source_drops_its_offsets_and_views(factory):
    with factory() as s:
        s.add(CloudCameraOffset(point_cloud_id="c1", source_id="s1", height_offset_m=-31.5))
        s.add(_view(id="v1", finding_id="f1"))
        s.commit()
    with factory() as s:
        s.delete(s.get(Source, "s1"))
        s.commit()
    with factory() as s:
        assert s.get(CloudCameraOffset, ("c1", "s1")) is None
        s.add(Source(id="s2", folder="C:/g", site="S"))
        s.flush()  # see the factory fixture's comment: raw FKs aren't flush-ordered across mappers
        s.add(CloudCameraOffset(point_cloud_id="c1", source_id="s2", height_offset_m=0.0))
        s.commit()
    with factory() as s:
        s.delete(s.get(PointCloud, "c1"))
        s.commit()
    with factory() as s:
        assert s.get(CloudCameraOffset, ("c1", "s2")) is None
        assert s.get(CloudView, "v1") is None
        assert s.get(CloudMeasurement, "m1") is None


@pytest.mark.parametrize(
    "subject", [dict(finding_id="f1", cloud_measurement_id="m1"), dict()], ids=["both", "neither"]
)
def test_a_view_has_exactly_one_subject(factory, subject):
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_view(id="bad", **subject))
        s.commit()


def test_a_subject_has_at_most_one_view(factory):
    with factory() as s:
        s.add(_view(id="v1", finding_id="f1"))
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_view(id="v1b", finding_id="f1"))
        s.commit()


def test_0013_freezes_its_view_check_instead_of_importing_the_model():
    """A later model edit must not rewrite 0013's history: the revision carries its own copy."""
    assert "from app.db.models" not in PATH.read_text(encoding="utf-8")
    assert _module().CLOUD_VIEW_SUBJECT_CHECK == CLOUD_VIEW_SUBJECT_CHECK
