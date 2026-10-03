"""Migration 0017 (plant model): additive only. One head, the ORM matches, the new tables cascade with
their parents, and an upgrade or a downgrade never touches an asset model's versions or runs (plan
2026-10-03-plant-model-f0 Task 4, Review Focus 5)."""

import sqlite3

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import AssetItem, AssetModel, AssetModelRun, SiteModelPackage
from app.db.session import MIGRATIONS, open_project_db

REVISION = "0017"
DOWN = "0016"
TABLES = {"asset_item": AssetItem, "site_model_package": SiteModelPackage}
T = "2026-10-03 00:00:00.000000"


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _columns(con, table) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def _seed_at_0016(folder) -> None:
    """A model with one version and one run, written at revision 0016 (before `kind` existed)."""
    command.upgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO asset_model (id, name, status, created_at, updated_at)"
        " VALUES ('m1', 'Tank', 'ready', ?, ?)",
        (T, T),
    )
    con.execute(
        "INSERT INTO asset_model_version (id, model_id, version, spec, kind, glb_status, source_ids,"
        " part_count, created_at) VALUES ('v1', 'm1', 1, '{}', 'manual', 'ready', '[]', 0, ?)",
        (T,),
    )
    con.execute(
        "INSERT INTO asset_model_run (id, model_id, job_id, provider, model_name, mode, state, phase,"
        " steps, open_questions, usage, sources, started_at) VALUES ('r1', 'm1', 'j1', 'anthropic',"
        " 'claude-opus-5-5', 'build', 'finished', 'done', '[]', '[]', '{}', '[]', ?)",
        (T,),
    )
    con.commit()
    con.close()


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # upgraded to head
    yield eng
    eng.dispose()


def test_the_chain_has_one_head_and_0017_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert script.get_revision(REVISION).down_revision == DOWN


def test_the_orm_and_the_migration_describe_the_same_tables(engine):
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    # Scoped to our tables and column by name; every diff kind (types, nullability, indexes) counts.
    ours = [d for d in diff if any(n in repr(d) for n in (*TABLES, "'asset_model', 'kind'"))]
    assert ours == []


def test_a_project_at_0016_upgrades_keeps_its_rows_and_defaults_kind(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    _seed_at_0016(folder)
    command.upgrade(_cfg(folder), REVISION)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert con.execute("SELECT id, kind FROM asset_model").fetchall() == [("m1", "asset")]
        assert con.execute("SELECT id FROM asset_model_version").fetchall() == [("v1",)]
        assert con.execute("SELECT id FROM asset_model_run").fetchall() == [("r1",)]
        assert set(TABLES) <= _tables(con)
    finally:
        con.close()


def test_an_upgrade_that_stopped_after_the_column_recovers(tmp_path):
    folder = tmp_path / "half"
    folder.mkdir()
    _seed_at_0016(folder)
    con = sqlite3.connect(folder / "project.db")
    con.execute("ALTER TABLE asset_model ADD COLUMN kind VARCHAR DEFAULT 'asset' NOT NULL")
    con.commit()
    con.close()
    command.upgrade(_cfg(folder), REVISION)  # must not fail on the column it meets again
    con = sqlite3.connect(folder / "project.db")
    try:
        assert set(TABLES) <= _tables(con)
    finally:
        con.close()


def test_0017_downgrades_to_0016_and_keeps_every_version_and_run(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    _seed_at_0016(folder)
    command.upgrade(_cfg(folder), REVISION)
    command.downgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert not set(TABLES) & _tables(con)
        assert "kind" not in _columns(con, "asset_model")
        assert con.execute("SELECT id FROM asset_model").fetchall() == [("m1",)]
        assert con.execute("SELECT id FROM asset_model_version").fetchall() == [("v1",)]
        assert con.execute("SELECT id FROM asset_model_run").fetchall() == [("r1",)]
    finally:
        con.close()
    command.upgrade(_cfg(folder), REVISION)  # and back up again


def test_items_and_packages_go_with_their_model_and_run(engine):
    with Session(engine) as s:
        m = AssetModel(name="Plant", status="ready", kind="plant")
        s.add(m)
        s.flush()
        run = AssetModelRun(model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant")
        s.add(run)
        s.flush()
        s.add(
            AssetItem(
                model_id=m.id,
                version=1,
                node="20-T-0001",
                name="LNG tank",
                type="tank_lng",
                height_source="drawing",
                confidence="high",
                flags=[],
                has_geometry=True,
            )
        )
        s.add(SiteModelPackage(run_id=run.id, n=1, label="Tank area", expected=["20-T-0001"]))
        s.commit()
        pkg = s.query(SiteModelPackage).one()
        assert (pkg.state, pkg.attempts, pkg.item_count, pkg.usage) == (
            "queued",
            0,
            0,
            {"input_tokens": 0, "output_tokens": 0},
        )
        assert s.get(AssetModel, m.id).kind == "plant"
        s.delete(run)
        s.commit()
        assert s.query(SiteModelPackage).count() == 0
        s.delete(s.get(AssetModel, m.id))
        s.commit()
        assert s.query(AssetItem).count() == 0


def test_a_package_state_outside_the_list_is_refused(engine):
    with Session(engine) as s:
        m = AssetModel(name="Plant", status="ready")
        s.add(m)
        s.flush()
        run = AssetModelRun(model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant")
        s.add(run)
        s.flush()
        s.add(SiteModelPackage(run_id=run.id, n=1, label="A", expected=[], state="paused"))
        with pytest.raises(Exception, match="CHECK constraint failed"):
            s.commit()
