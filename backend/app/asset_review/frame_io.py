# backend/app/asset_review/frame_io.py
"""The asset frame on import and on edit (spec 2026-10-02-asset-findings §4 A7, §5.1, §5.2).

- `CONVERSIONS`: source frame -> canonical frame (metres, Y up, X plant north, Z plant east), 4x4,
  row-major, applied to column vectors. `asset_glb_import` bakes the chosen one into the stored GLB
  as a root node matrix, once.
- `silhouette_from_mesh`: the kit's `records.py` `mesh_info` (92nd percentile of vertex radius in
  160 height bins, smoothed over 5), number for number.
- `frame_after_import`, `rescale_review`, `resolve_review`, `apply_patch`: how an import and
  `PATCH /asset-models/{id}` change `asset_model.frame` and `asset_model.review`.
"""

from __future__ import annotations

import copy
from typing import Any

import numpy as np
import trimesh
from pydantic import ValidationError

from app.asset_review.frame import Frame, Origin
from app.asset_review.profiles import PROFILES, resolve
from app.errors import AppError

SILHOUETTE_BINS = 160
SILHOUETTE_PERCENTILE = 92
SILHOUETTE_SMOOTH = 5
OPEN_BOUND_M = 1e8  # a zone bound beyond this is an open end (the kit writes 1e9); never rescaled
DEFAULT_DATUM_LABEL = "Ground"

CONVERSIONS: dict[str, np.ndarray] = {
    # Already canonical.
    "none": np.eye(4),
    # KIPIC and three.js scenes: x = east, y = up, z = -north. Canonical X (north) = -z, Y = y,
    # Z (east) = x.
    "x_east_minus_z_north": np.array(
        [
            [0.0, 0.0, -1.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    ),
    # Z-up ENU exports (most photogrammetry): x = east, y = north, z = up. Canonical X (north) = y,
    # Y (up) = z, Z (east) = x.
    "enu_z_up": np.array(
        [
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    ),
}


def matrix_of(conversion: str) -> np.ndarray | None:
    """The root matrix to bake for `conversion`; None when the GLB is already canonical."""
    m = CONVERSIONS[conversion]  # KeyError for an unknown key
    return None if conversion == "none" else m


def silhouette_from_mesh(mesh: trimesh.Trimesh, bins: int = SILHOUETTE_BINS) -> list[tuple[float, float]]:
    """[(y, r)] from the canonical-frame vertices: the kit's `mesh_info`, number for number."""
    v = np.asarray(mesh.vertices, dtype=float)
    if len(v) == 0:
        return []
    y0, y1 = float(v[:, 1].min()), float(v[:, 1].max())
    r = np.hypot(v[:, 0], v[:, 2])
    edges = np.linspace(min(0.0, y0), y1, bins + 1)
    idx = np.clip(np.digitize(v[:, 1], edges) - 1, 0, bins - 1)
    ys: list[float] = []
    rs: list[float] = []
    for b in range(bins):
        rb = r[idx == b]
        if len(rb):
            ys.append(float((edges[b] + edges[b + 1]) / 2))
            rs.append(float(np.percentile(rb, SILHOUETTE_PERCENTILE)))
    smooth = np.array(rs)
    if len(smooth) > SILHOUETTE_SMOOTH:
        half = SILHOUETTE_SMOOTH // 2
        kernel = np.ones(SILHOUETTE_SMOOTH) / SILHOUETTE_SMOOTH
        smooth = np.convolve(np.pad(smooth, half, mode="edge"), kernel, mode="valid")
    return [(round(y, 3), round(float(x), 3)) for y, x in zip(ys, smooth, strict=True)]


def _pairs(silhouette) -> list[list[float]]:
    return [[float(y), float(r)] for y, r in silhouette]


def frame_after_import(
    old: dict | None,
    prev_meta: dict | None,
    height_m: float,
    silhouette: list[tuple[float, float]],
    origin: dict | None,
) -> dict:
    """The model's frame after a GLB import.

    - No frame yet: one from the GLB (height, silhouette), north offset 0, no levels or presets.
    - A frame whose height and silhouette are still the previous import's (`prev_meta`), or whose
      silhouette is empty: those two follow the new GLB. Anything the operator edited stays.
    - `origin`, when the import names one, fills the frame's origin if it has none; an origin the
      operator or a kit import set is kept (C0: "sets `frame.origin` when the model has no frame yet").
    """
    if old is None:
        frame = Frame(
            origin=Origin.model_validate(origin) if origin else None,
            north_offset_deg=0.0,
            height_m=height_m,
            datum_label=DEFAULT_DATUM_LABEL,
            datum_note="",
            line_azimuth_deg=None,
            silhouette=[tuple(p) for p in _pairs(silhouette)],
            levels=[],
            presets=[],
        )
        return frame.model_dump(mode="json")
    frame = Frame.model_validate(old)
    current = _pairs(frame.silhouette)
    untouched = not current or (
        prev_meta is not None
        and prev_meta.get("silhouette") == current
        and prev_meta.get("height_m") == frame.height_m
    )
    update: dict[str, Any] = {}
    if untouched:
        update["height_m"] = height_m
        update["silhouette"] = [tuple(p) for p in _pairs(silhouette)]
    if origin and frame.origin is None:
        update["origin"] = Origin.model_validate(origin)
    return Frame.model_validate({**frame.model_dump(), **update}).model_dump(mode="json")


def rescale_review(review: dict, old_h: float, new_h: float) -> dict:
    """Zones in metres follow a height change proportionally; a cluster distance still at the
    default max(0.75, 0.02 * H) follows too. Open-ended bounds and operator values are kept."""
    out = copy.deepcopy(review)
    if not old_h or old_h <= 0 or new_h <= 0:
        return out
    k = new_h / old_h
    for zone in out.get("zones") or []:
        for key in ("min_m", "max_m"):
            v = zone.get(key)
            if isinstance(v, int | float) and abs(v) < OPEN_BOUND_M:
                zone[key] = round(v * k, 3)
    c = out.get("cluster_m")
    if isinstance(c, int | float) and abs(c - max(0.75, 0.02 * old_h)) < 1e-9:
        out["cluster_m"] = max(0.75, 0.02 * new_h)
    return out


def resolve_review(raw: dict | None, frame: dict | None) -> dict | None:
    """A PATCH `review` (a profile id, or an edited copy that also names its profile) resolved
    against the frame's height into the stored review config."""
    if raw is None:
        return None
    pid = raw.get("profile_id")
    if not isinstance(pid, str) or pid not in PROFILES:
        raise AppError("unknown_profile", f"There is no review profile {pid!r}.", 422)
    if not frame:
        raise AppError(
            "frame_required",
            "Set the asset frame (at least its height) before choosing a review profile.",
            422,
        )
    overrides = {k: v for k, v in raw.items() if k != "profile_id"} or None
    try:
        return resolve(pid, float(frame["height_m"]), overrides).model_dump(mode="json")
    except (ValidationError, ValueError, TypeError, KeyError, AttributeError) as e:
        n = len(e.errors()) if isinstance(e, ValidationError) else 1
        raise AppError(
            "invalid_review", "The review settings are not valid.", 422, {"error_count": n}
        ) from None


def apply_patch(row, fields: dict) -> None:
    """Apply the `frame` and `review` keys a PATCH body set. A height change with no new review
    rescales the stored review's zones."""
    old_h = float(row.frame["height_m"]) if row.frame else None
    if "frame" in fields:
        raw = fields["frame"]
        row.frame = None if raw is None else Frame.model_validate(raw).model_dump(mode="json")
        if raw is None and "review" not in fields:
            row.review = None  # a review is resolved against the frame's height; without one it is stale
    if "review" in fields:
        row.review = resolve_review(fields["review"], row.frame)
    elif row.review and row.frame and old_h and float(row.frame["height_m"]) != old_h:
        row.review = rescale_review(row.review, old_h, float(row.frame["height_m"]))
