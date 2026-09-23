"""Point GDAL and PROJ at the data folders the frozen bundle carries.

rasterio's Windows wheels ship `gdal_data/` and `proj_data/` inside the package. In a PyInstaller
build they land under `_MEIPASS/rasterio/`, where GDAL does not look on its own, and a missing
PROJ database turns every reprojection into "proj_create: no database context specified".
An operator-set value always wins: a GIS workstation may point these at its own install on purpose.
"""

from __future__ import annotations

import os
import sys
from collections.abc import MutableMapping
from pathlib import Path


def _bundle_base() -> Path | None:
    if not getattr(sys, "frozen", False):
        return None
    return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))


def configure_gdal_env(
    base: Path | None = None, environ: MutableMapping[str, str] | None = None
) -> dict[str, str]:
    """Set GDAL_DATA, PROJ_DATA and PROJ_LIB from the bundle; returns what was set."""
    env = os.environ if environ is None else environ
    base = base if base is not None else _bundle_base()
    if base is None:
        return {}
    wanted = {
        "GDAL_DATA": base / "rasterio" / "gdal_data",
        "PROJ_DATA": base / "rasterio" / "proj_data",
        "PROJ_LIB": base / "rasterio" / "proj_data",
    }
    applied: dict[str, str] = {}
    for key, folder in wanted.items():
        if key in env or not folder.is_dir():
            continue
        env[key] = str(folder)
        applied[key] = str(folder)
    return applied
