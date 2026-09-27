"""Vector drawing tiles (spec §8.4): one bucket lookup, clip, transform, simplify, cap.

Bounded per tile (spec §13): runs thinner than one pixel are dropped; at most MAX_READ vertices are
read; clip, transform and simplify touch only those; at most MAX_OUT vertices leave. Both caps use
`_allot`: longest first, a run that does not fit what is left is skipped (shorter ones still get
their turn), and a run larger than the whole cap is decimated instead of dropped, so one huge
polyline can never blank a tile. Past either cap `truncated` is set.
"""

from __future__ import annotations

import functools
from pathlib import Path

import numpy as np

from app.drawings import georef as fitting
from app.drawings import runs, site
from app.surfaces.design.store import read_json

MAX_OUT = 20_000
MAX_READ = 400_000
BUFFER = 0.02
LABEL_MIN_PX = 6
DECIMALS = 3


@functools.lru_cache(maxsize=64)
def _labels(path: str, mtime_ns: int) -> tuple[dict, ...]:
    return tuple(read_json(Path(path)))


def _load_labels(folder: Path) -> tuple[dict, ...]:
    p = folder / "labels.json"
    return _labels(str(p), p.stat().st_mtime_ns) if p.is_file() else ()


def _box(t, conv: site.Conversion, z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """The tile's outline (densified) in drawing coordinates, grown by BUFFER."""
    ex, ey = site.ring(site.tile_bounds(z, x, y))
    dx, dy = conv.from_site(ex, ey)
    sx, sy = fitting.apply(fitting.invert(t), np.asarray(dx), np.asarray(dy))
    x0, y0, x1, y1 = float(sx.min()), float(sy.min()), float(sx.max()), float(sy.max())
    pad = BUFFER * max(x1 - x0, y1 - y0)
    return (x0 - pad, y0 - pad, x1 + pad, y1 + pad)


def _to_site(t, conv: site.Conversion):
    def fn(c: np.ndarray) -> np.ndarray:
        e, n = fitting.apply(t, c[:, 0], c[:, 1])
        e, n = conv.to_site(e, n)
        return np.column_stack([e, n])

    return fn


def _allot(sizes: np.ndarray, order: np.ndarray, budget: int) -> tuple[np.ndarray, bool]:
    """Vertices granted to each item under `budget`, visiting `order` (most important first).

    An item that fits what is left gets all its vertices; one that fits the budget but not what is
    left is skipped; one larger than the whole budget gets half of what is left (at least 2), read
    decimated. Vectorised per round; each round ends at a skip or a decimation, and a decimation
    halves what is left, so the rounds are few. Returns (grants, anything skipped or decimated).
    """
    grant = np.zeros(len(sizes), np.int64)
    left, cand, cut = int(budget), order, False
    while cand.size and left >= 2:
        s = sizes[cand]
        cs = np.cumsum(s)
        n = int(np.searchsorted(cs, left, side="right"))
        if n:
            grant[cand[:n]] = s[:n]
            left -= int(cs[n - 1])
        cand = cand[n:]
        if not cand.size:
            break
        cut = True
        head = cand[0]
        if sizes[head] > budget and left >= 2:
            grant[head] = max(2, left // 2)
            left -= int(grant[head])
            cand = cand[1:]
        cand = cand[(sizes[cand] <= left) | (sizes[cand] > budget)]
    return grant, cut or bool(cand.size)


def _sample(starts: np.ndarray, lens: np.ndarray, take: np.ndarray) -> np.ndarray:
    """Indices of `take` evenly strided vertices of each run (first and last kept; all when take == len)."""
    first = np.cumsum(take) - take
    j = np.arange(int(take.sum())) - np.repeat(first, take)
    step = np.repeat((lens - 1) / np.maximum(take - 1, 1), take)
    return np.repeat(starts, take) + np.rint(j * step).astype(np.int64)


def vector_tile(
    folder: Path,
    layers: list[dict],
    t,
    conv: site.Conversion,
    frame_unit_m: float,
    z: int,
    x: int,
    y: int,
    *,
    dst_unit_m: float,
) -> dict:
    """`t` maps drawing units to the destination CRS (`dst_unit_m` metres per unit); the tile grid
    is in site-frame units (`frame_unit_m`). Raises FileNotFoundError when the drawing's files are
    gone (a delete raced the request)."""
    import shapely

    r = site.res(z)
    # Site-frame units per drawing unit (the dst -> site grid scale factor is ignored, ruling 15).
    site_scale = fitting.scale_of(t) * dst_unit_m / frame_unit_m
    box = _box(t, conv, z, x, y)
    truncated = False
    out_layers: list[dict] = []
    idx = runs.BucketIndex(folder)
    try:
        rs = runs.RunStore.open(folder)
    except BaseException:
        idx.release(collect=True)  # exception cleanup: a traceback may still hold a view
        raise
    try:
        ids = idx.query(box)
        if ids.size:
            bb = np.asarray(idx.bbox[ids])
            diag = np.hypot(bb[:, 2] - bb[:, 0], bb[:, 3] - bb[:, 1])
            visible = diag >= r / site_scale  # one site pixel, in drawing units
            ids, diag = ids[visible], diag[visible]
            starts = np.asarray(rs.runs[ids])
            lens = np.asarray(rs.runs[ids + 1]) - starts
            take = lens
            if lens.sum() > MAX_READ:
                take, truncated = _allot(lens, np.argsort(-diag, kind="stable"), MAX_READ)
                pick = take > 0
                ids, starts, lens, take = ids[pick], starts[pick], lens[pick], take[pick]
            if ids.size:
                coords = np.asarray(rs.lines[_sample(starts, lens, take)])
                geoms = shapely.linestrings(coords, indices=np.repeat(np.arange(len(ids)), take))
                clipped = shapely.clip_by_rect(geoms, *box)
                moved = shapely.transform(clipped, _to_site(t, conv))
                simple = shapely.simplify(moved, r / 2, preserve_topology=False)
                parts, owner = shapely.get_parts(simple, return_index=True)
                lines = shapely.get_type_id(parts) == 1
                parts, owner = parts[lines], owner[lines]
                counts = shapely.get_num_coordinates(parts).astype(np.int64)
                keep = counts >= 2
                parts, owner, counts = parts[keep], owner[keep], counts[keep]
                xy = shapely.get_coordinates(parts)
                pstarts = np.cumsum(counts) - counts
                keep_n = counts
                if counts.sum() > MAX_OUT:
                    order = np.argsort(-shapely.length(parts), kind="stable")
                    keep_n, cut = _allot(counts, order, MAX_OUT)
                    truncated = truncated or cut
                    pick = keep_n > 0
                    owner, counts, pstarts, keep_n = owner[pick], counts[pick], pstarts[pick], keep_n[pick]
                xy = np.round(xy[_sample(pstarts, counts, keep_n)], DECIMALS)
                layer_of = np.asarray(rs.layer[ids[owner]])
                bounds = np.concatenate([[0], np.cumsum(keep_n)])
                grouped: dict[int, list[list[float]]] = {}
                for k in range(len(keep_n)):
                    grouped.setdefault(int(layer_of[k]), []).append(
                        xy[bounds[k] : bounds[k + 1]].ravel().tolist()
                    )
                out_layers = [
                    {"name": layers[i]["name"], "colour": layers[i]["colour"], "lines": grouped[i]}
                    for i in sorted(grouped)
                ]
    finally:
        idx.release()
        rs.release()
    turn = fitting.rotation_of(t)
    labels = []
    for lab in _load_labels(folder):
        if not (box[0] <= lab["x"] <= box[2] and box[1] <= lab["y"] <= box[3]):
            continue
        height_site = lab["height"] * site_scale
        if height_site / r < LABEL_MIN_PX:
            continue
        e, n = conv.to_site(*fitting.apply(t, np.array([lab["x"]]), np.array([lab["y"]])))
        labels.append(
            {
                "text": lab["text"],
                "x": round(float(np.asarray(e)[0]), DECIMALS),
                "y": round(float(np.asarray(n)[0]), DECIMALS),
                "height_m": round(height_site * frame_unit_m, DECIMALS),
                "rotation": round((lab["rotation"] + turn) % 360.0, 6),
                "layer": lab["layer"],
            }
        )
    return {"layers": out_layers, "labels": labels, "truncated": truncated}
