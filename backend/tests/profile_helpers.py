"""Fixtures for the C-B2 cross-section profile tests (spec 2026-09-26-point-cloud-workspace section 15).

A wall section is a vertical wall (both faces) on flat ground, laid across a line that runs east from
(X0, Y0), so a point's s is its x - X0 and its t is its y - Y0. Coordinates are multiples of the
fixtures' 0.001 m scale, so the LAS stores them exactly.
"""

from __future__ import annotations

from pathlib import Path

import laspy
import numpy as np
from pointclouds import ORIGIN, insert_cloud

X0, Y0, Z0 = ORIGIN


def wall_section(
    *,
    wall_from: float = 5.0,
    wall_to: float = 5.4,
    length: float = 10.0,
    height: float = 10.0,
    step: float = 0.05,
) -> np.ndarray:
    """Wall faces at s = wall_from and wall_to for z in (0, height], ground at z = 0 for s in
    [0, length], each at t in {-0.05, 0, 0.05}. float64 (n, 3) in native coordinates."""
    ts = (-0.05, 0.0, 0.05)
    zs = np.round(np.arange(1, int(round(height / step)) + 1) * step, 3)
    ss = np.round(np.arange(0, int(round(length / step)) + 1) * step, 3)
    wall = [(X0 + s, Y0 + t, Z0 + z) for s in (wall_from, wall_to) for z in zs for t in ts]
    ground = [(X0 + s, Y0 + t, Z0) for s in ss for t in ts]
    return np.array(wall + ground, dtype=np.float64)


def line_points(length: float = 10.0, dy: float = 0.0, z: float = 1.0) -> list[dict]:
    """The section line A -> B, east from (X0, Y0 + dy), as measurement points."""
    return [
        {"x": X0, "y": Y0 + dy, "z": Z0 + z, "uncertainty_m": 0.01},
        {"x": X0 + length, "y": Y0 + dy, "z": Z0 + z, "uncertainty_m": 0.01},
    ]


def cloud_from_las(handle, src: Path, **overrides) -> str:
    """A ready point_cloud row for the LAS at `src`: true bounds, size and mtime as import records them."""
    with laspy.open(src) as r:
        las = r.read()
        scale = list(map(float, r.header.scales))
    xyz = np.column_stack([las.x, las.y, las.z])
    st = src.stat()
    values = dict(
        name="Chimney stack 3D",
        source_path=str(src),
        source_size=st.st_size,
        source_mtime=st.st_mtime,
        source_sha256="ab" * 32,
        point_count=len(xyz),
        scale=scale,
        bounds_native=[*map(float, xyz.min(0)), *map(float, xyz.max(0))],
    )
    values.update(overrides)
    return insert_cloud(handle, **values)


def insert_profile(
    handle, cloud_id: str, *, status: str = "computing", job_id: str | None = None, **fields
) -> str:
    """A `profile` cloud_measurement row on the default wall-section line."""
    from app.db.models import CloudMeasurement

    a, b = line_points()
    values = dict(
        point_cloud_id=cloud_id,
        kind="profile",
        name="Cross-section 1",
        note=None,
        points=[a, b],
        results={},
        params={"thickness_m": 0.2, "max_points": 200_000},
        status=status,
        error="boom" if status == "failed" else None,
        job_id=job_id,
    )
    values.update(fields)
    with handle.session() as s:
        row = CloudMeasurement(**values)
        s.add(row)
        s.flush()
        return row.id
