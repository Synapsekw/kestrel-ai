"""Snapshot dispatch (spec §9.1, §9.5): the key, the process-wide render slots, the cache and the
placeholder fallback. `render_to_cache` never raises for a bad source: a missing or unreadable
source, an over-limit spec or a renderer crash all yield the grey placeholder with the reason, and a
placeholder is never stored under the snapshot's key (plan ruling 4)."""

from __future__ import annotations

import functools
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
    SnapshotUnavailable,
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


def _clamp_out(size: tuple[int, int]) -> tuple[int, int]:
    """Each side clamped to check_limits' own 16-2400 bounds, so a spec that has not (yet) been
    through check_limits, e.g. a missing source, where render_result never calls check_limits,
    cannot produce a placeholder outside the sizes a real render is ever allowed."""
    w, h = size
    return (min(max(int(w), MIN_OUT), MAX_OUT), min(max(int(h), MIN_OUT), MAX_OUT))


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
        return _clamp_out(out_of(spec))
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
        try:
            cache.prune(handle)
        except OSError:  # review finding 3: a locked/unreadable cache folder never costs the
            # snapshot that was just rendered and cached.
            log.warning("snapshot cache prune failed", exc_info=True)


def _crashed(key: str, spec) -> str:
    log.exception("snapshot %s (%s) failed", key, getattr(spec, "kind", "?"))
    return UNKNOWN_FAILURE


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
        except SnapshotUnavailable as e:
            reason = e.reason
        except LookupError as e:
            # Controller ruling (review finding 2): only SnapshotUnavailable and an exact
            # LookupError(reason) are operator-facing reasons. A renderer *bug* that happens to
            # raise some other LookupError subclass (KeyError, IndexError, ...) is not a reason a
            # human wrote for the operator, so it is logged and treated like any other crash.
            if type(e) is LookupError:
                reason = str(e.args[0]) if e.args else UNKNOWN_FAILURE
            else:
                reason = _crashed(key, spec)
        except Exception:
            reason = _crashed(key, spec)
        else:
            try:
                cache.write_jpeg(img, path, getattr(renderer, "JPEG_QUALITY", cache.JPEG_QUALITY))
            except OSError:
                if path.is_file():
                    # Review finding 1: two threads/processes can miss the same key at once and
                    # both render; the second `os.replace` onto the same destination can raise on
                    # Windows (e.g. PermissionError from a concurrent reader holding it open) even
                    # though a valid JPEG already landed there. Serve it rather than a false
                    # placeholder.
                    return SnapshotResult(key, path, None)
                log.warning(
                    "snapshot %s (%s) cache write failed", key, getattr(spec, "kind", "?"), exc_info=True
                )
                reason = UNKNOWN_FAILURE
    if reason is not None:
        return _placeholder(handle, key, reason, size)
    _after_miss(handle)
    return SnapshotResult(key, path, None)


def render_to_cache(handle, spec) -> Path:
    """The cached JPEG for `spec`, or the placeholder's; never raises for a bad source."""
    return render_result(handle, spec).path


@functools.cache
def _spec_adapter():
    """R0's `SnapshotSpec` TypeAdapter, built once (amendment A18): constructing it walks the whole
    discriminated union, and `parse_spec` runs on every preview and every figure a job composes."""
    from pydantic import TypeAdapter

    from app.reports.schemas import SnapshotSpec

    return TypeAdapter(SnapshotSpec)


def parse_spec(data: dict):
    """`data` validated as R0's SnapshotSpec (a discriminated union on `kind`). ValueError
    (pydantic's ValidationError, a ValueError subclass) when it is not one."""
    value = _spec_adapter().validate_python(data)
    return getattr(value, "root", value)


def snapshot_ref(handle, spec):
    """The SnapshotRef a composer puts in a `figure` block: the key now, the known output size and
    the missing source's reason (R2, R9). Rendering happens later (preview or job)."""
    from app.reports.schemas import SnapshotRef
    from app.reports.snapshots.keys import MAX_SPEC_CHARS, encode_spec

    key, sv = compute_key(handle, spec)
    width, height = output_size(spec)
    if len(encode_spec(spec)) > MAX_SPEC_CHARS:
        log.warning("snapshot spec %s is over %d chars; compact its ring or geometry", key, MAX_SPEC_CHARS)
    return SnapshotRef(
        key=key, spec=spec, width_px=width, height_px=height, missing_reason=missing_reason(sv)
    )
