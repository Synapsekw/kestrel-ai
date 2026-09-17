from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

MIGRATIONS = Path(__file__).parent / "migrations"


def _db_url(folder: Path) -> str:
    return f"sqlite:///{(folder / 'project.db').as_posix()}"


def open_project_db(folder: Path):
    """Create the engine for a project folder and bring its schema to head."""
    engine = create_engine(_db_url(folder), future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", _db_url(folder))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    return engine


def make_session_factory(engine):
    return sessionmaker(engine, class_=Session, expire_on_commit=False, future=True)
