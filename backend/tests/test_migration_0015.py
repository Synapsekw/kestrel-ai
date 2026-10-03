"""Migration 0015 (asset models): single head, up/down keeps rows, ORM matches the migration."""

import sqlite3

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

from app.db.base import Base
from app.db.models import AssetModel, AssetModelRun, AssetModelVersion
from app.db.session import MIGRATIONS, open_project_db

REVISION = "0015"
DOWN = "0014"
TABLES = {
    "asset_model": AssetModel,
    "asset_model_version": AssetModelVersion,
    "asset_model_run": AssetModelRun,
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # upgraded to head
    yield eng
    eng.dispose()


def test_the_chain_has_one_head_and_0015_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}


def test_tables_exist_after_upgrade(engine):
    with engine.connect() as conn:
        names = set(engine.dialect.get_table_names(conn))
    assert set(TABLES) <= names


def test_orm_matches_migration(engine):
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    # Scoped to our tables by name; every diff kind (types, nullability, defaults, indexes) counts.
    ours = [d for d in diff if any(name in repr(d) for name in TABLES)]
    assert ours == []


def test_a_project_at_0014_upgrades_and_keeps_its_rows(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    command.upgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)"
        " VALUES ('c1', 'C', 'ready', 'C:/c.las', 1, '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()

    command.upgrade(_cfg(folder), REVISION)

    con = sqlite3.connect(folder / "project.db")
    try:
        assert con.execute("SELECT id, name FROM point_cloud").fetchall() == [("c1", "C")]
        assert set(TABLES) <= _tables(con)
    finally:
        con.close()


def test_0015_downgrades_to_0014(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    command.upgrade(_cfg(folder), REVISION)
    command.downgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert not set(TABLES) & _tables(con)
        assert "point_cloud" in _tables(con)
    finally:
        con.close()
