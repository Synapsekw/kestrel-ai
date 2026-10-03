"""asset_locator: a finding on its asset model, drawn on the server (spec 2026-10-02-asset-findings
§10, decision A9). Orthographic along the finding's normal turned by the profile's oblique angle,
framed on a square of `half_extent_m` around the finding, with a pin or the patch outline in the
severity colour. The mesh comes from J1's per-process cache; one patch file (at most 64 KB) is read.
Nothing heavy loads at import: the snapshot dispatcher imports this module eagerly."""

from __future__ import annotations

import math
import struct

import numpy as np

from app.reports.snapshots import MISSING, SnapshotUnavailable
from app.surfaces.design.store import ID_RE

JPEG_QUALITY = 88
GONE = "The asset model version for this finding no longer exists"
NOT_READY = "The asset model has no 3D model file for this version yet"
MAX_OUT = 1024  # the rasterizer's own cap
MAX_PATCH_BYTES = 64 * 1024  # one patch file is read, never more than this


def _glb(handle, spec):
    from app.asset_models.store import version_glb_path

    return version_glb_path(handle, spec.asset_model_id, int(spec.version))


def patch_bin(handle, spec):
    """J3's patch file for the spec's sighting, or None for a pin or an id that is not an id."""
    if spec.mark != "patch" or not spec.sighting_id or not ID_RE.fullmatch(spec.sighting_id):
        return None
    from app.asset_review.jobs_place import placements_dir

    return placements_dir(handle, spec.asset_model_id, int(spec.version)) / f"{spec.sighting_id}.bin"


def _stamp(path) -> str:
    st = path.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"


def source_version(handle, spec) -> str:
    """The GLB's size and mtime (versions are never rewritten), plus the patch file's for a patch."""
    try:
        glb = _glb(handle, spec)
    except Exception:  # not_found for an id that is not an id
        return MISSING + GONE
    if not glb.is_file():
        return MISSING + NOT_READY
    sv = _stamp(glb)
    try:
        patch = patch_bin(handle, spec)
        if patch is not None and patch.is_file():
            sv += "|" + _stamp(patch)
    except Exception:
        pass
    return sv


def view_direction(normal, oblique_deg: float) -> tuple[float, float, float]:
    """Looking against the normal (onto the surface), turned about the vertical by `oblique_deg`."""
    n = np.asarray(normal, dtype=float)
    norm = float(np.linalg.norm(n))
    n = n / norm if norm > 1e-9 else np.array([1.0, 0.0, 0.0])
    f = -n
    a = math.radians(float(oblique_deg))
    c, s = math.cos(a), math.sin(a)
    turned = (c * f[0] + s * f[2], f[1], -s * f[0] + c * f[2])
    return tuple(0.0 if abs(v) < 1e-12 else float(v) for v in turned)


def _hull(pts: np.ndarray) -> list[int]:
    """Indices of the 2D convex hull, counter-clockwise (monotone chain; deterministic)."""
    order = sorted(range(len(pts)), key=lambda i: (float(pts[i][0]), float(pts[i][1]), i))

    def cross(o: int, a: int, b: int) -> float:
        return float(
            (pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1])
            - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0])
        )

    lower: list[int] = []
    for i in order:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], i) <= 0:
            lower.pop()
        lower.append(i)
    upper: list[int] = []
    for i in reversed(order):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], i) <= 0:
            upper.pop()
        upper.append(i)
    return lower[:-1] + upper[:-1]


def patch_outline(path, direction) -> list[tuple[float, float, float]]:
    """The patch's outline as seen along `direction`: the hull of its vertices in the view plane.
    Empty for a missing, oversized or corrupt file (the caller falls back to the pin)."""
    from app.asset_models.raster import View, basis
    from app.asset_review.place import decode_patch

    try:
        with open(path, "rb") as f:
            raw = f.read(MAX_PATCH_BYTES + 1)
        if len(raw) > MAX_PATCH_BYTES:
            return []
        pos, _uvs = decode_patch(raw)
    except (OSError, ValueError, struct.error):
        return []
    pos = pos.astype(float)
    if len(pos) < 3 or not np.isfinite(pos).all():
        return []
    _, right, up = basis(View("custom", direction=tuple(direction)))
    hull = _hull(np.c_[pos @ right, pos @ up])
    return [tuple(float(v) for v in pos[i]) for i in hull]


def _load_mesh(handle, model_id: str, version: int):
    from app.asset_review.meshes import load_version_mesh  # J1: cached per process by GLB sha256
    from app.errors import AppError

    try:
        mesh, _face_node = load_version_mesh(handle, model_id, version)
    except (AppError, FileNotFoundError) as e:
        raise SnapshotUnavailable(NOT_READY) from e
    return mesh


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    v = int(hex_colour[1:7], 16)
    return (v >> 16) & 255, (v >> 8) & 255, v & 255


def render(handle, spec):
    from app.asset_models.raster import Marker, View
    from app.asset_models.raster import render as raster_render

    mesh = _load_mesh(handle, spec.asset_model_id, int(spec.version))
    direction = view_direction(spec.normal, float(spec.oblique_deg))
    rgb = _rgb(spec.colour)
    markers = []
    patch = patch_bin(handle, spec)
    if patch is not None and patch.is_file():
        ring = patch_outline(patch, direction)
        if len(ring) >= 3:
            markers.append(Marker("outline", tuple(ring), rgb))
    if not markers:
        markers.append(Marker("pin", (tuple(float(v) for v in spec.center),), rgb))
    size = int(spec.out[0])
    return raster_render(
        {"asset": mesh},
        View("custom", direction=direction),
        size=size,
        window=(tuple(float(v) for v in spec.center), float(spec.half_extent_m)),
        markers=markers,
    )
