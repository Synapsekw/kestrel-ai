"""Is a surface a usable target: a ready cloud DSM whose surface.tif exists (spec §5, §12)."""

from __future__ import annotations

from typing import Literal

from sqlalchemy import select

from app.db.models import Surface
from app.surfaces.paths import surface_path

TargetState = Literal["ready", "not_ready", "not_a_cloud"]


def target_state(handle, surface_id: str) -> TargetState:
    """`not_a_cloud`: no such surface, or not a cloud_dsm. `not_ready`: a cloud_dsm that is building,
    failed, or whose surface.tif is missing. `ready`: usable as a target."""
    with handle.session() as s:
        row = s.execute(select(Surface).where(Surface.id == surface_id)).scalar_one_or_none()
        if row is None or row.kind != "cloud_dsm":
            return "not_a_cloud"
        ready = row.status == "ready"
    return "ready" if ready and surface_path(handle, surface_id).is_file() else "not_ready"


def target_ready(handle, surface_id: str) -> bool:
    return target_state(handle, surface_id) == "ready"
