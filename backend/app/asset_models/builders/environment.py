"""Environment meshes (plant model spec 2026-10-03 §5 EnvFeature, unit B3).

`build_env(feature, ctx)` turns one EnvFeature into scene-frame meshes (metres, x = plant N,
y = EL - datum, z = plant E; identity placement under the GLB's `environment/` group). Land is a
ground cap at `el` with a rock-armour skirt sloping down and out to below sea level; sea is a flat,
up-facing surface the Site 3D view swaps for its water shader (extras {"env": "sea"}); the other
kinds are thin slabs. Never raises: a degenerate feature yields [].
"""

from __future__ import annotations

import logging

import numpy as np
import trimesh
from shapely.geometry import Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode
from app.asset_models.builders.civil import (
    LIFT,
    SLAB_T,
    clean_line,
    is_closed,
    largest_polygon,
    prism,
    surface,
)
from app.asset_models.spec import EnvFeature

log = logging.getLogger(__name__)

LAND_DEPTH_M = 8.0  # skirt drop when there is no sea feature (Cowork's platform slab depth)
SEA_TOE_M = 2.5  # the skirt toe sits this far below the sea surface (Cowork: -9 vs -6.44)
ARMOUR_RUN = 1.1  # horizontal run per metre of drop on the land edge (Cowork: 10 m over 9 m)
MATERIAL = {
    "road": "Asphalt",
    "paved": "Paving",
    "laydown": "Laydown",
    "slope": "Slope",
    "revetment": "Rock_Armour",
}


def _scene_ring(feature: EnvFeature, ctx: BuildCtx) -> tuple[Polygon, float]:
    pts = clean_line(np.asarray(feature.pts, dtype=float).reshape(-1, 2))
    if is_closed(pts):
        pts = pts[:-1]
    if len(pts) < 3:
        raise ValueError("an environment feature needs 3 distinct points")
    if ctx.grid is not None:
        xyz = np.asarray(ctx.grid.plant_to_scene(pts[:, 0], pts[:, 1], np.full(len(pts), feature.el)))
        xz, y0 = xyz[:, [0, 2]], float(xyz[0, 1])
    else:
        xz, y0 = np.column_stack([pts[:, 1], pts[:, 0]]), float(feature.el)
    return largest_polygon(Polygon(xz)), y0


def _skirt(poly: Polygon, y_top: float, y_toe: float) -> trimesh.Trimesh:
    """A band from the outline at y_top, out by ARMOUR_RUN per metre of drop, down to y_toe."""
    ring = np.asarray(poly.exterior.coords)[:-1]  # counter-clockwise in (x, z)
    run = (y_top - y_toe) * ARMOUR_RUN
    nxt, prv = np.roll(ring, -1, axis=0), np.roll(ring, 1, axis=0)

    def unit(v):
        return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)

    n_out = unit(np.column_stack([(nxt - ring)[:, 1], -(nxt - ring)[:, 0]]))
    n_in = unit(np.column_stack([(ring - prv)[:, 1], -(ring - prv)[:, 0]]))
    bis = unit(n_out + n_in)
    cos_half = np.clip(np.sum(bis * n_out, axis=1), 0.35, 1.0)  # mitre limit ~2.9x
    outer = ring + bis * (run / cos_half)[:, None]
    k = len(ring)
    v = np.vstack(
        [
            np.column_stack([ring[:, 0], np.full(k, y_top), ring[:, 1]]),
            np.column_stack([outer[:, 0], np.full(k, y_toe), outer[:, 1]]),
        ]
    )
    i = np.arange(k)
    j = (i + 1) % k
    faces = np.vstack([np.column_stack([i, k + i, j]), np.column_stack([j, k + i, k + j])])
    m = trimesh.Trimesh(v, faces, process=False)
    if m.face_normals[:, 1].mean() < 0:
        m = trimesh.Trimesh(v, faces[:, ::-1], process=False)
    return m


def build_env(feature: EnvFeature, ctx: BuildCtx, *, sea_el: float | None = None) -> list[MeshNode]:
    try:
        poly, y = _scene_ring(feature, ctx)
        extras = {"env": feature.kind, "id": feature.id}
        if feature.kind == "sea":
            return [MeshNode(feature.id, "Sea", surface(poly, y), extras)]
        if feature.kind == "land":
            drop = (feature.el - sea_el + SEA_TOE_M) if sea_el is not None else LAND_DEPTH_M
            drop = max(drop, 0.5)
            return [
                MeshNode(feature.id, "Ground", surface(poly, y), extras),
                MeshNode(f"{feature.id}-edge", "Rock_Armour", _skirt(poly, y, y - drop), dict(extras)),
            ]
        mat = MATERIAL[feature.kind]
        top = y + LIFT[mat]
        return [MeshNode(feature.id, mat, prism(poly, top - SLAB_T, top), extras)]
    except Exception as exc:  # a broken feature never fails the GLB
        # names and types only: never the exception text or the points (project logging rule)
        log.warning("environment feature %s (%s) skipped: %s", feature.id, feature.kind, type(exc).__name__)
        return []


def build_environment(features: list[EnvFeature], ctx: BuildCtx) -> list[MeshNode]:
    """Every feature, land skirts reaching below the lowest sea feature (when there is one)."""
    seas = [f.el for f in features if f.kind == "sea"]
    sea_el = min(seas) if seas else None
    return [n for f in features for n in build_env(f, ctx, sea_el=sea_el)]
