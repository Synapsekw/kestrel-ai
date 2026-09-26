"""Where the app-wide model library lives. The only place that knows this path (spec section 4.1)."""

from pathlib import Path


def library_root(data_dir: Path) -> Path:
    """`%APPDATA%/kestrel-ai/library`, beside the rest of the app data."""
    return Path(data_dir) / "library"
