"""The library handle: shaped like a ProjectHandle (`id`, `folder`, `runs_dir`, `session()`), so the
existing JobRunner runs library jobs without knowing the difference."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.db.session import make_session_factory
from app.errors import AppError
from app.library.paths import library_root

MIGRATIONS = Path(__file__).parent / "migrations"
DB_NAME = "library.db"
LIBRARY_UNAVAILABLE = "The model library could not be opened."


class LibraryHandle:
    id = "library"

    def __init__(self, folder: Path, engine):
        self.folder, self.engine = folder, engine
        self._factory = make_session_factory(engine)

    runs_dir = property(lambda s: s.folder / "runs")
    models_dir = property(lambda s: s.folder / "models")

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()


def _db_url(folder: Path) -> str:
    return f"sqlite:///{(folder / DB_NAME).as_posix()}"


def open_library(data_dir: Path) -> LibraryHandle:
    """Create the library folders if needed and bring `library.db` to its newest schema."""
    root = library_root(data_dir)
    for sub in ("runs", "models"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    engine = create_engine(_db_url(root), future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", _db_url(root))
    try:
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")
    except Exception:
        engine.dispose()
        raise
    return LibraryHandle(root, engine)


def library_unavailable() -> AppError:
    return AppError("library_unavailable", LIBRARY_UNAVAILABLE, 503)


def get_library(request: Request) -> LibraryHandle:
    """FastAPI dependency: the open library, or 503 `library_unavailable` when startup failed."""
    lib = getattr(request.app.state, "library", None)
    if lib is None:
        raise library_unavailable()
    return lib
