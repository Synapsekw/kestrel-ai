"""Replay a kit's `surface.json` (spec 2026-10-02-asset-findings §6.5 step 6, mode replay).

The kit already cast its rays on the same GLB, so its points, patches (geometry, texture, label
grid) and unplaced keys are taken as they are, written through J3's patch format, and marked
`placed_version = current`. The file (up to 20 MB on DAMAC) is streamed with ijson in three passes
(`patches`, `points`, `unmapped`): one patch in memory at a time, at most CHUNK sighting updates
per commit.
"""

from __future__ import annotations

import base64
import io
import logging
from collections import Counter
from pathlib import Path

import ijson
import numpy as np
from PIL import Image as PILImage
from sqlalchemy import func, select

from app.asset_review import jobs_place
from app.asset_review.kit_format import Kit, KitError, _vec3
from app.asset_review.kit_sightings import PART_MAX
from app.asset_review.place import PatchData, index_entry, read_index, write_index, write_patch
from app.db.models import FindingSighting

TEXTURE_MAX_PX = 512  # spec §5.7
LABELS_MAX_PX = 128
CHUNK = 50

log = logging.getLogger(__name__)


def _items(path: Path, prefix: str):
    try:
        with path.open("rb") as f:
            yield from ijson.items(f, prefix, use_float=True)
    except ijson.JSONError as e:
        raise KitError(f"surface.json could not be read: {type(e).__name__}.") from None


def texture_from_data_url(url: str) -> PILImage.Image:
    head, _, b64 = str(url).partition(",")
    if not head.startswith("data:image/") or not b64:
        raise KitError("A surface.json patch has no texture image.")
    try:
        with PILImage.open(io.BytesIO(base64.b64decode(b64))) as im:
            tex = im.convert("RGBA")
    except (OSError, ValueError) as e:
        raise KitError("A surface.json patch texture could not be read.") from e
    if max(tex.size) > TEXTURE_MAX_PX:
        tex.thumbnail((TEXTURE_MAX_PX, TEXTURE_MAX_PX), PILImage.NEAREST)
    return tex


def labels_from_kit(item: dict) -> np.ndarray:
    """The kit's label grid (one byte per cell, nonzero = marked) at most 128 px on its long side."""
    w, h = int(item["labelWidth"]), int(item["labelHeight"])
    raw = np.frombuffer(base64.b64decode(item["labels"]), dtype=np.uint8)
    if w <= 0 or h <= 0 or raw.size != w * h:
        raise KitError("A surface.json patch has a label grid of the wrong size.")
    lab = (raw.reshape(h, w) > 0).astype(np.uint8)
    if max(w, h) > LABELS_MAX_PX:
        s = LABELS_MAX_PX / max(w, h)
        small = PILImage.fromarray(lab * 255).resize(
            (max(1, round(w * s)), max(1, round(h * s))), PILImage.NEAREST
        )
        lab = (np.asarray(small) > 0).astype(np.uint8)
    return lab


def patch_from_kit(item: dict, sx: float = 1.0, sy: float = 1.0) -> PatchData:
    """`sx`, `sy`: stored-image px per kit preview px, for the crop (J3 keeps it in image px)."""
    n = int(item["vertexCount"])
    pos = np.frombuffer(base64.b64decode(item["positions"]), dtype="<f4")
    uvs = np.frombuffer(base64.b64decode(item["uvs"]), dtype="<f4")
    if n <= 0 or n % 3 or pos.size != n * 3 or uvs.size != n * 2:
        raise KitError("A surface.json patch has positions or uvs of the wrong length.")
    return PatchData(
        positions=pos.reshape(n, 3).astype(np.float32),
        uvs=uvs.reshape(n, 2).astype(np.float32),
        texture=texture_from_data_url(item["textureData"]),
        labels=labels_from_kit(item),
        crop=_crop(item.get("sourceCrop"), sx, sy),
        direction=_vec3(item.get("direction")) or (0.0, 0.0, 1.0),
        size=_size(item.get("size")),
    )


def _crop(value, sx: float, sy: float) -> tuple[float, float, float, float]:
    try:
        x0, y0, x1, y1 = (float(c) for c in value)
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 0.0)
    return (x0 * sx, y0 * sy, x1 * sx, y1 * sy)


def _size(value) -> tuple[float, float]:
    try:
        w, h = (float(c) for c in value)
    except (TypeError, ValueError):
        return (0.0, 0.0)
    return (w, h)


def _rel(handle, path) -> str:
    p = Path(path)
    return p.relative_to(handle.folder).as_posix() if p.is_absolute() else p.as_posix()


def _placed(kind: str, center, normal, part, patch_path: str | None, version: int) -> dict:
    c = _vec3(center) if kind != "none" else None
    if c is None:
        kind = "none"
    n = _vec3(normal) if c is not None else None
    return {
        "placement": kind,
        "cx": c[0] if c else None,
        "cy": c[1] if c else None,
        "cz": c[2] if c else None,
        "nx": n[0] if n else None,
        "ny": n[1] if n else None,
        "nz": n[2] if n else None,
        "patch_path": patch_path if kind == "patch" else None,
        "placed_version": int(version),
        "part": part,
    }


def replay(
    handle,
    ctx,
    asset_model_id: str,
    version: int,
    kit: Kit,
    keys: dict[str, str],
    lo: float,
    hi: float,
    scales: dict[str, tuple[float, float]] | None = None,
) -> dict:
    """`keys`: kit key (finding id, or photo id for the photo unit) -> sighting id. `scales`:
    sighting id -> stored-image px per preview px (for the patch crop; 1:1 when absent)."""
    scales = scales or {}
    out_dir = jobs_place.placements_dir(handle, asset_model_id, version)
    out_dir.mkdir(parents=True, exist_ok=True)
    key_field = "finding" if kit.unit == "region" else "photo"
    done: set[str] = set()
    pending: list[tuple[str, dict]] = []
    counts: Counter = Counter()
    entries: dict[str, dict] = {}
    total = max(1, len(keys))

    def flush() -> None:
        if pending:
            with handle.session() as s:
                for sid, fields in pending:
                    row = s.get(FindingSighting, sid)
                    if row is None:
                        continue
                    part = fields.pop("part")
                    for name, value in fields.items():
                        setattr(row, name, value)
                    if part and not row.part:
                        row.part = str(part)[:PART_MAX]
            pending.clear()
        ctx.progress(lo + (hi - lo) * len(done) / total, f"Placing sightings {len(done):,} / {len(keys):,}")

    def take(key) -> str | None:
        sid = keys.get(str(key or ""))
        if sid is None or sid in done:
            counts["orphans"] += 1
            return None
        return sid

    for item in _items(kit.surface_path, "patches.item"):
        ctx.check_cancelled()
        sid = take(item.get(key_field))
        if sid is None:
            continue
        try:
            patch = patch_from_kit(item, *scales.get(sid, (1.0, 1.0)))
        except (KitError, KeyError, TypeError, ValueError):
            counts["bad"] += 1  # the sighting stays pending; computing placements fills it later
            continue
        path = write_patch(out_dir, sid, patch)
        entries[sid] = index_entry(patch)
        done.add(sid)
        pending.append(
            (
                sid,
                _placed(
                    "patch",
                    item.get("center"),
                    item.get("direction"),
                    item.get("component"),
                    _rel(handle, path),
                    version,
                ),
            )
        )
        if len(pending) >= CHUNK:
            flush()
    for item in _items(kit.surface_path, "points.item"):
        ctx.check_cancelled()
        sid = take(item.get("finding") or item.get(key_field))
        if sid is None:
            continue
        done.add(sid)
        pending.append(
            (
                sid,
                _placed(
                    "point", item.get("center"), item.get("normal"), item.get("component"), None, version
                ),
            )
        )
        if len(pending) >= CHUNK:
            flush()
    for key in _items(kit.surface_path, "unmapped.item"):
        ctx.check_cancelled()
        sid = take(key)
        if sid is None:
            continue
        done.add(sid)
        pending.append((sid, _placed("none", None, None, None, None, version)))
        if len(pending) >= CHUNK:
            flush()
    flush()
    if entries:
        try:
            write_index(out_dir, asset_model_id, version, {**read_index(out_dir), **entries})
        except OSError as e:  # derived and a reader may hold it; the next placement run rewrites it
            log.warning("could not write the placements index: %s", e)
    return {"orphans": counts["orphans"], "bad": counts["bad"]}


def mark_unplaced(handle, sighting_ids: list[str], version: int) -> None:
    """Replay mode, photo unit: a photo's regions other than the largest carry no placement of
    their own (coordinator ruling on N7); its finding takes the largest region's patch."""
    ids = list(sighting_ids)
    with handle.session() as s:
        for i in range(0, len(ids), 500):
            for row in s.execute(
                select(FindingSighting).where(FindingSighting.id.in_(ids[i : i + 500]))
            ).scalars():
                row.placement, row.placed_version = "none", int(version)
                row.cx = row.cy = row.cz = row.nx = row.ny = row.nz = None
                row.patch_path = None


def placement_counts(handle, sighting_ids: list[str]) -> dict[str, int]:
    out = dict.fromkeys(("patch", "point", "none", "pending"), 0)
    ids = list(sighting_ids)
    with handle.session() as s:
        for i in range(0, len(ids), 500):
            q = (
                select(FindingSighting.placement, func.count())
                .where(FindingSighting.id.in_(ids[i : i + 500]))
                .group_by(FindingSighting.placement)
            )
            for kind, n in s.execute(q).all():
                out[kind] = out.get(kind, 0) + int(n)
    return out
