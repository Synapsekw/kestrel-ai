"""The catalogue handle, shaped like the library handle: a folder, an engine and `session()`."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app.catalogue.db import CatalogueMeta, SeverityLevel
from app.catalogue.paths import DB_NAME, catalogue_root
from app.db.session import make_session_factory
from app.errors import AppError

MIGRATIONS = Path(__file__).parent / "migrations"
CATALOGUE_UNAVAILABLE = "The catalogue could not be opened."
SEEDED = "seeded"
# D4's default scale (spec section 4.1, "Severity defaults").
DEFAULT_SCALE = (
    (1, "Minor", "#3fb68e"),
    (2, "Moderate", "#e2bf2e"),
    (3, "Major", "#ff9c3a"),
    (4, "Critical", "#ff5a4f"),
)


class CatalogueHandle:
    def __init__(self, folder: Path, engine):
        self.folder, self.engine = folder, engine
        self._factory = make_session_factory(engine)

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


def seed(handle: CatalogueHandle) -> None:
    """First open only: D4's four levels. The marker keeps an operator's later edits (a removed top
    level, say) from being seeded back on the next start."""
    with handle.session() as s:
        if s.get(CatalogueMeta, SEEDED) is not None:
            return
        if s.execute(select(func.count()).select_from(SeverityLevel)).scalar_one() == 0:
            s.add_all(SeverityLevel(level=lv, name=n, colour=c) for lv, n, c in DEFAULT_SCALE)
        s.add(CatalogueMeta(key=SEEDED, value=True))


def open_catalogue(data_dir: Path) -> CatalogueHandle:
    """Create the folder if needed, bring `catalogue.db` to its newest schema and seed it."""
    root = catalogue_root(data_dir)
    root.mkdir(parents=True, exist_ok=True)
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
        handle = CatalogueHandle(root, engine)
        seed(handle)
    except Exception:
        engine.dispose()
        raise
    return handle


# The name MG's plan uses (dry run and migration steps open the catalogue directly).
open_catalogue_db = open_catalogue


def catalogue_unavailable() -> AppError:
    return AppError("catalogue_unavailable", CATALOGUE_UNAVAILABLE, 503)


def get_catalogue(request: Request) -> CatalogueHandle:
    """FastAPI dependency: the open catalogue, or 503 `catalogue_unavailable` when startup failed."""
    cat = getattr(request.app.state, "catalogue", None)
    if cat is None:
        raise catalogue_unavailable()
    return cat
