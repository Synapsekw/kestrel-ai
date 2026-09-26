from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.migration.backup import backup_project_db, needs_backup

MIGRATIONS = Path(__file__).parent / "migrations"


def _db_url(folder: Path) -> str:
    return f"sqlite:///{(folder / 'project.db').as_posix()}"


def alembic_config(folder: Path | None = None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", _db_url(folder))
    return cfg


def project_script() -> ScriptDirectory:
    return ScriptDirectory.from_config(alembic_config())


def head_revision() -> str:
    return project_script().get_current_head()


def current_revision(folder: Path) -> str | None:
    """The database's Alembic revision, read without the WAL pragma; None for a missing or new file."""
    if not (Path(folder) / "project.db").exists():
        return None
    probe = create_engine(_db_url(Path(folder)), poolclass=NullPool)
    try:
        with probe.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        probe.dispose()


def open_project_db(folder: Path):
    """Create the engine for a project folder and bring its schema to head.

    Copy-first (foundation spec §11.2): when the upgrade will apply the foundation revision, the
    database is backed up before Alembic runs, and a failed backup raises `BackupFailed` with the
    database untouched. Every path that opens a project comes through here.
    """
    folder = Path(folder)
    if needs_backup(current_revision(folder), project_script()):
        backup_project_db(folder)
    engine = create_engine(_db_url(folder), future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = alembic_config(folder)
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    return engine


def make_session_factory(engine):
    return sessionmaker(engine, class_=Session, expire_on_commit=False, future=True)
