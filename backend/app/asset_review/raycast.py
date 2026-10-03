# backend/app/asset_review/raycast.py
"""First-hit ray casting in numpy (spec 2026-10-02-asset-findings §6.3), with no rtree or embree.

trimesh's ray engine needs `rtree`, which is not installed and is not added (plan J3, coordinator
ruling), so placement casts its own rays. Every ray of one call shares one origin (a camera) and
points into one narrow cone (a sighting's box). That makes a cheap two-level cull exact:

1. Project the mesh's vertices onto a plane in front of the origin (`x = d.r / d.f`, `y = d.u / d.f`
   along the rays' mean direction `f`). A ray can only hit a triangle when its projection falls
   inside the triangle's projected bounds. Triangles wholly behind the origin are dropped; one that
   crosses the origin's plane is kept for every ray.
2. Split the rays' projected rectangle into tiles of about `RAYS_PER_TILE` rays, and test each
   tile's rays against only the candidates whose bounds overlap that tile (Moller-Trumbore,
   vectorised, at most `PAIR_BUDGET` ray-triangle pairs at a time).

Cost per call: one pass over the vertices and faces (O(V + F): about 0.14 s for 1.3M faces), plus
the tile tests, which scale with the rays times the triangles near them, not with the mesh. Rays
with different origins, or a cone wider than `MIN_FORWARD` allows, fall back to testing every
triangle in blocks.
"""

from __future__ import annotations

import math

import numpy as np

RAYS_PER_TILE = 16
PAIR_BUDGET = 1_000_000  # ray x triangle pairs per Moller-Trumbore block (about 100 MB of float64)
MIN_FORWARD = 0.1  # every ray within about 84 degrees of the cone axis, or the fallback runs
EPS_DET = 1e-12
EPS_T = 1e-9


def first_hits(
    vertices: np.ndarray, faces: np.ndarray, origins: np.ndarray, directions: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """The nearest hit of each ray: `(t, face)` arrays of length n; `t = inf`, `face = -1` on a miss.
    `directions` need not be unit length; `t` is in units of each direction's length."""
    n = len(origins)
    t_best = np.full(n, np.inf)
    f_best = np.full(n, -1, dtype=np.int64)
    if n == 0 or len(faces) == 0:
        return t_best, f_best
    vertices = np.asarray(vertices, dtype=float)
    faces = np.asarray(faces, dtype=np.int64)
    origins = np.asarray(origins, dtype=float)
    directions = np.asarray(directions, dtype=float)
    every = np.arange(len(faces))
    o = origins[0]
    axis = directions.sum(axis=0)
    norm = np.linalg.norm(axis)
    if not np.allclose(origins, o) or norm == 0:
        _blocks(vertices, faces, every, origins, directions, np.arange(n), t_best, f_best)
        return t_best, f_best
    f = axis / norm
    unit = directions / np.linalg.norm(directions, axis=1)[:, None]
    fwd = unit @ f
    if fwd.min() < MIN_FORWARD:
        _blocks(vertices, faces, every, origins, directions, np.arange(n), t_best, f_best)
        return t_best, f_best
    helper = np.array([0.0, 1.0, 0.0]) if abs(f[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    r = np.cross(f, helper)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    rx, ry = (unit @ r) / fwd, (unit @ u) / fwd

    rel = vertices - o
    depth = rel @ f
    front = depth > EPS_T
    safe = np.where(front, depth, 1.0)
    vx, vy = (rel @ r) / safe, (rel @ u) / safe
    fd = front[faces]
    any_front = fd.any(axis=1)
    straddle = any_front & ~fd.all(axis=1)
    fx, fy = vx[faces], vy[faces]
    x0, x1 = fx.min(axis=1), fx.max(axis=1)
    y0, y1 = fy.min(axis=1), fy.max(axis=1)
    x0[straddle], y0[straddle] = -np.inf, -np.inf
    x1[straddle], y1[straddle] = np.inf, np.inf
    overlap = (x1 >= rx.min()) & (x0 <= rx.max()) & (y1 >= ry.min()) & (y0 <= ry.max())
    cand = np.nonzero(any_front & overlap)[0]
    if cand.size == 0:
        return t_best, f_best
    cx0, cx1, cy0, cy1 = x0[cand], x1[cand], y0[cand], y1[cand]

    tiles = max(1, int(math.ceil(math.sqrt(n / RAYS_PER_TILE))))
    ex = np.linspace(rx.min(), rx.max(), tiles + 1)
    ey = np.linspace(ry.min(), ry.max(), tiles + 1)
    ix = np.clip(np.searchsorted(ex, rx, side="right") - 1, 0, tiles - 1)
    iy = np.clip(np.searchsorted(ey, ry, side="right") - 1, 0, tiles - 1)
    tile = iy * tiles + ix
    for k in np.unique(tile):
        rays = np.nonzero(tile == k)[0]
        lo_x, hi_x = rx[rays].min(), rx[rays].max()
        lo_y, hi_y = ry[rays].min(), ry[rays].max()
        near = cand[(cx1 >= lo_x) & (cx0 <= hi_x) & (cy1 >= lo_y) & (cy0 <= hi_y)]
        if near.size:
            _blocks(vertices, faces, near, origins, directions, rays, t_best, f_best)
    return t_best, f_best


def _blocks(vertices, faces, tri_ids, origins, directions, ray_ids, t_best, f_best) -> None:
    """Moller-Trumbore of `ray_ids` against `tri_ids`, in blocks of at most PAIR_BUDGET pairs;
    updates `t_best`/`f_best` in place where a block finds a nearer hit."""
    step = max(1, PAIR_BUDGET // max(1, len(ray_ids)))
    o = origins[ray_ids][:, None, :]
    d = directions[ray_ids][:, None, :]
    for start in range(0, len(tri_ids), step):
        ids = tri_ids[start : start + step]
        v = vertices[faces[ids]]  # (k, 3, 3)
        v0 = v[:, 0][None]
        e1 = (v[:, 1] - v[:, 0])[None]
        e2 = (v[:, 2] - v[:, 0])[None]
        p = np.cross(d, e2)
        det = np.einsum("ijk,ijk->ij", e1, p)
        ok = np.abs(det) > EPS_DET
        inv = np.divide(1.0, det, out=np.zeros_like(det), where=ok)
        s = o - v0
        uu = np.einsum("ijk,ijk->ij", s, p) * inv
        q = np.cross(s, e1)
        vv = np.einsum("ijk,ijk->ij", d, q) * inv
        t = np.einsum("ijk,ijk->ij", e2, q) * inv
        hit = ok & (uu >= 0) & (vv >= 0) & (uu + vv <= 1) & (t > EPS_T)
        t = np.where(hit, t, np.inf)
        j = t.argmin(axis=1)
        tj = t[np.arange(len(ray_ids)), j]
        better = tj < t_best[ray_ids]
        t_best[ray_ids[better]] = tj[better]
        f_best[ray_ids[better]] = ids[j[better]]
