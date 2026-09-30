"""Snapshot dispatch (spec §9.1, §9.5): the key, the process-wide render slots, the cache and the
placeholder fallback. `render_to_cache` never raises for a bad source: a missing or unreadable
source, an over-limit spec or a renderer crash all yield the grey placeholder with the reason, and a
placeholder is never stored under the snapshot's key (plan ruling 4)."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple

from PIL import Image as PILImage

from app.reports.snapshots import (
    DEFAULT_OUT,
    MISSING,
    attachment,
    cache,
    image_crop,
    map_view,
    opt,
    out_of,
    view3d,
    volume_plan,
)
from app.reports.snapshots.keys import canonical_json, key_of, plain

log = logging.getLogger(__name__)

UNKNOWN_FAILURE = "The snapshot could not be rendered"
INVALID_SPEC = "The snapshot spec is not valid"
PRUNE_EVERY = 16
MIN_OUT, MAX_OUT = 16, 2400
# R0's models (amendment A2): image_crop ring 1-4096, map/elevation geometry 1-4096 positions.
MAX_VERTICES = 4096
MIN_CONTEXT, MAX_CONTEXT = 1.0, 10.0
MIN_SPLIT, MAX_SPLIT = 0.05, 0.95
MIN_EXTENT_M_FLOOR = 1.0
ITEM_KINDS = ("map", "elevation")
GEOMETRY_TYPES = ("Point", "LineString", "Polygon")


class Renderer(NamedTuple):
    """A renderer pair for the kinds one module serves several of (map_view). A renderer module
    (image_crop, volume_plan, attachment, view3d) has the same attributes, JPEG_QUALITY optional."""

    source_version: Callable[[Any, Any], str]
    render: Callable[[Any, Any], PILImage.Image]
    JPEG_QUALITY: int = cache.JPEG_QUALITY


RENDERERS: dict[str, Any] = {
    "image_crop": image_crop,
    "map": Renderer(map_view.map_source_version, map_view.render_map_spec),
    "elevation": Renderer(map_view.elevation_source_version, map_view.render_elevation_spec),
    "pair": Renderer(map_view.pair_source_version, map_view.render_pair_spec),
    "volume_plan": volume_plan,
    "attachment": attachment,  # R9-I replaces the module's bodies
    "view3d": view3d,  # R9-C replaces the module's bodies; JPEG_QUALITY = 88
}

# Spec §9.5: at most two snapshot renders at once in this process (endpoint threads and job threads).
RENDER_SLOTS = threading.BoundedSemaphore(2)
_misses = 0
_misses_lock = threading.Lock()


@dataclass(frozen=True)
class SnapshotResult:
    key: str
    path: Path
    missing_reason: str | None


def output_size(spec) -> tuple[int, int]:
    """The figure's pixel size, known before rendering (plan ruling 6)."""
    kind = getattr(spec, "kind", None)
    if kind == "pair":
        return output_size(spec.a)
    if kind == "view3d":
        return view3d.OUT
    if kind == "volume_plan":
        return volume_plan.OUT
    try:
        return out_of(spec)
    except (TypeError, ValueError, IndexError):
        return DEFAULT_OUT


def _positions(coords) -> int:
    if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
        return 1
    return sum(_positions(c) for c in coords) if isinstance(coords, (list, tuple)) else 0


def check_limits(spec) -> None:
    """ValueError for a spec no report produces: absurd sizes, unknown kinds, huge rings (ruling 13,
    amendment A2 for the exact bounds: context 1-10, 1-4096 vertices, 0.05<=split<=0.95,
    min_extent_m>=1 when present, out sides 16-2400)."""
    kind = getattr(spec, "kind", None)
    if kind not in RENDERERS:
        raise ValueError(f"unknown snapshot kind {kind!r}")
    if kind == "pair":
        for part in (spec.a, spec.b):
            if getattr(part, "kind", None) not in ITEM_KINDS:
                raise ValueError("a pair compares two map or elevation views")
            check_limits(part)
        if not MIN_SPLIT <= float(opt(spec, "split", 0.5)) <= MAX_SPLIT:
            raise ValueError(f"split must lie between {MIN_SPLIT} and {MAX_SPLIT}")
        return
    out = getattr(spec, "out", None)
    if out is not None and (len(out) != 2 or not all(MIN_OUT <= int(v) <= MAX_OUT for v in out)):
        raise ValueError(f"out must be two sides of {MIN_OUT} to {MAX_OUT} px")
    if kind == "image_crop":
        if not 1 <= len(spec.ring or []) <= MAX_VERTICES:
            raise ValueError(f"the ring must have 1 to {MAX_VERTICES} vertices")
        if not MIN_CONTEXT <= float(opt(spec, "context", 3.0)) <= MAX_CONTEXT:
            raise ValueError(f"context must lie between {MIN_CONTEXT} and {MAX_CONTEXT}")
    if kind in ITEM_KINDS:
        geometry = plain(getattr(spec, "geometry", None))
        if geometry is not None:
            if not isinstance(geometry, dict) or geometry.get("type") not in GEOMETRY_TYPES:
                raise ValueError("geometry must be a GeoJSON Point, LineString or Polygon")
            if not 1 <= _positions(geometry.get("coordinates")) <= MAX_VERTICES:
                raise ValueError(f"geometry must have 1 to {MAX_VERTICES} vertices")
        if float(opt(spec, "min_extent_m", 40.0)) < MIN_EXTENT_M_FLOOR:
            raise ValueError(f"min_extent_m must be at least {MIN_EXTENT_M_FLOOR}")


def missing_reason(source_version: str) -> str | None:
    return source_version[len(MISSING) :] if source_version.startswith(MISSING) else None


def compute_key(handle, spec) -> tuple[str, str]:
    """(key, source_version) for `spec` now (spec §9.1). ValueError/TypeError for a spec that has
    no canonical form (NaN, a non-JSON value)."""
    renderer = RENDERERS.get(getattr(spec, "kind", None))
    sv = renderer.source_version(handle, spec) if renderer else f"{MISSING}{INVALID_SPEC}"
    return key_of(canonical_json(spec), sv), sv


def _after_miss(handle) -> None:
    global _misses
    with _misses_lock:
        _misses += 1
        due = _misses % PRUNE_EVERY == 1
    if due:
        cache.prune(handle)


def _placeholder(handle, key: str, reason: str, size) -> SnapshotResult:
    return SnapshotResult(key, cache.placeholder_path(handle, reason, size), reason)


def render_result(handle, spec) -> SnapshotResult:
    size = output_size(spec)
    try:
        key, sv = compute_key(handle, spec)
    except (ValueError, TypeError):
        return _placeholder(handle, "", INVALID_SPEC, size)
    reason = missing_reason(sv)
    if reason is None:
        try:
            check_limits(spec)
        except (ValueError, TypeError) as e:
            reason = str(e)
    if reason is not None:
        return _placeholder(handle, key, reason, size)
    path = cache.cached_path(handle, key)
    if path.is_file():
        cache.touch(path)
        return SnapshotResult(key, path, None)
    with RENDER_SLOTS:
        if path.is_file():  # another thread rendered it while this one waited for a slot
            return SnapshotResult(key, path, None)
        renderer = RENDERERS[spec.kind]
        try:
            img = renderer.render(handle, spec)
            if img.size != tuple(size):
                raise RuntimeError(f"{spec.kind} rendered {img.size}, expected {size}")
        except LookupError as e:  # SnapshotUnavailable, or a renderer's LookupError(reason)
            reason = getattr(e, "reason", None) or (str(e.args[0]) if e.args else UNKNOWN_FAILURE)
        except Exception:
            log.exception("snapshot %s (%s) failed", key, getattr(spec, "kind", "?"))
            reason = UNKNOWN_FAILURE
        else:
            try:
                cache.write_jpeg(img, path, getattr(renderer, "JPEG_QUALITY", cache.JPEG_QUALITY))
            except OSError:  # A13: a cache write never turns into an unhandled exception
                reason = UNKNOWN_FAILURE
    if reason is not None:
        return _placeholder(handle, key, reason, size)
    _after_miss(handle)
    return SnapshotResult(key, path, None)


def render_to_cache(handle, spec) -> Path:
    """The cached JPEG for `spec`, or the placeholder's; never raises for a bad source."""
    return render_result(handle, spec).path
