"""Where a measurement's files live (spec 2026-09-23-volumes §3): `<project>/volumes/<id>/`."""

from pathlib import Path


def measurement_dir(handle, measurement_id: str) -> Path:
    return handle.volumes_dir / measurement_id


def diff_path(handle, measurement_id: str) -> Path:
    """dz = top - base (shift applied), NaN outside the measured cells; the grid convention."""
    return measurement_dir(handle, measurement_id) / "diff.tif"
