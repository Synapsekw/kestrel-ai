"""Where a surface lives on disk (spec 2026-09-23-volumes §3): `<project>/surfaces/<id>/`."""

from pathlib import Path


def surface_dir(handle, surface_id: str) -> Path:
    return handle.surfaces_dir / surface_id


def surface_path(handle, surface_id: str) -> Path:
    """The grid itself: `surface.tif`, written as `surface.tif.partial` and renamed."""
    return surface_dir(handle, surface_id) / "surface.tif"
