"""Part transforms in the asset frame (spec 2026-10-02 §6.2). Millimetres.

A free part is moved to `origin_mm` with its local +Y turned onto `axis`. A shell-mounted part sits
on its host's outer wall at (bearing, elevation), pointing radially out. A head-mounted part sits on
the head's outer surface at plant (e, n), pointing along the head's facing.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh

from app.asset_models.shapes import head_surface_y
from app.asset_models.spec import HEAD_HOSTS, SHELL_HOSTS, Part

UP = np.array([0.0, 1.0, 0.0])


class PlacementError(Exception):
    pass


def bearing_dir(bearing_deg: float) -> np.ndarray:
    a = math.radians(bearing_deg)
    return np.array([math.cos(a), 0.0, math.sin(a)])


def _aim(axis, origin) -> np.ndarray:
    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)
    T = np.eye(4)
    if not np.allclose(axis, UP):
        if np.allclose(axis, -UP):
            T = trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])
        else:
            T = trimesh.geometry.align_vectors(UP, axis)
    T[:3, 3] = origin
    return T


def _shell_radius(host: Part, y_local: float) -> float:
    p = host.typed_params()
    if host.shape == "cylinder":
        return p.id / 2 + p.thickness
    t = min(max(y_local / p.height, 0.0), 1.0)  # cone: outer radius by height
    return p.d_bottom / 2 + (p.d_top / 2 - p.d_bottom / 2) * t


def part_transform(part: Part, parts_by_id: dict[str, Part]) -> np.ndarray:
    pl = part.placement
    if pl.host is None:
        return _aim(pl.axis, pl.origin_mm)
    host = parts_by_id.get(pl.host)
    if host is None:
        raise PlacementError(f"host {pl.host!r} is not a part of this model")
    hy = host.placement.origin_mm[1]
    if pl.bearing_deg is not None:
        if host.shape not in SHELL_HOSTS:
            raise PlacementError(f"host {pl.host!r} is not a shell (cylinder or cone)")
        d = bearing_dir(pl.bearing_deg)
        r = _shell_radius(host, pl.elevation_mm - hy)
        centre = np.array([host.placement.origin_mm[0], 0.0, host.placement.origin_mm[2]])
        origin = centre + d * r + np.array([0.0, pl.elevation_mm, 0.0])
        return _aim(d, origin)
    if host.shape not in HEAD_HOSTS:
        raise PlacementError(f"host {pl.host!r} is not a head or plate")
    hp = host.typed_params()
    r = math.hypot(pl.e_mm, pl.n_mm)
    y = hy + head_surface_y(hp, r)
    origin = np.array([host.placement.origin_mm[0] + pl.n_mm, y, host.placement.origin_mm[2] + pl.e_mm])
    facing_down = getattr(hp, "facing", "up") == "down"
    return _aim(-UP if facing_down else UP, origin)
