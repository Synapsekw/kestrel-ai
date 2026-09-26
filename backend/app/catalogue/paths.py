"""Where the app-wide catalogue lives. The only place that knows this path (spec F1)."""

from pathlib import Path

DB_NAME = "catalogue.db"


def catalogue_root(data_dir: Path) -> Path:
    """`%APPDATA%/kestrel-ai/library`: next to library.db, its own file and Alembic history, so a
    corrupt library cannot take the catalogue down, and the reverse."""
    return Path(data_dir) / "library"
