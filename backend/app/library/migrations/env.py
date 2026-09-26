import sys
from pathlib import Path

from alembic import context

_ROOT = str(Path(__file__).resolve().parents[3])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from app.library.db import LibraryBase  # noqa: E402

config = context.config
target_metadata = LibraryBase.metadata


def run_migrations_online() -> None:
    """`open_library` always hands over its own connection; there is no offline mode."""
    connection = config.attributes["connection"]
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
