"""Vector drawing tiles (spec §8.4): one bucket lookup, clip, transform, simplify, cap.

Bounded per tile (spec §13): runs thinner than one pixel are dropped; at most MAX_READ vertices are
read (longest runs first); clip, transform and simplify touch only those; at most MAX_OUT vertices
leave (shortest parts dropped first). Past either cap `truncated` is set.
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


def vector_tile(
    folder: Path, layers: list[dict], t, conv: site.Conversion, frame_unit_m: float, z: int, x: int, y: int
) -> dict:
    import shapely

    r = site.res(z)
    box = _box(t, conv, z, x, y)
    truncated = False
    out_layers: list[dict] = []
    idx, rs = runs.BucketIndex(folder), runs.RunStore.open(folder)
    try:
        ids = idx.query(box)
        if ids.size:
            bb = np.asarray(idx.bbox[ids])
            diag = np.hypot(bb[:, 2] - bb[:, 0], bb[:, 3] - bb[:, 1])
            visible = diag >= r / fitting.scale_of(t)  # one site pixel, in drawing units
            ids, diag = ids[visible], diag[visible]
            starts = np.asarray(rs.runs[ids])
            lens = np.asarray(rs.runs[ids + 1]) - starts
            if lens.sum() > MAX_READ:
                order = np.argsort(-diag, kind="stable")
                ok = np.cumsum(lens[order]) <= MAX_READ
                pick = np.sort(order[ok])
                ids, starts, lens = ids[pick], starts[pick], lens[pick]
                truncated = True
            if ids.size:
                first = np.cumsum(lens) - lens  # where each run starts in the gathered array
                gather = np.repeat(starts - first, lens) + np.arange(int(lens.sum()))
                coords = np.asarray(rs.lines[gather])
                geoms = shapely.linestrings(coords, indices=np.repeat(np.arange(len(ids)), lens))
                clipped = shapely.clip_by_rect(geoms, *box)
                moved = shapely.transform(clipped, _to_site(t, conv))
                simple = shapely.simplify(moved, r / 2, preserve_topology=False)
                parts, owner = shapely.get_parts(simple, return_index=True)
                lines = shapely.get_type_id(parts) == 1
                parts, owner = parts[lines], owner[lines]
                counts = shapely.get_num_coordinates(parts)
                keep = counts >= 2
                parts, owner, counts = parts[keep], owner[keep], counts[keep]
                if counts.sum() > MAX_OUT:
                    order = np.argsort(-shapely.length(parts), kind="stable")
                    ok = np.cumsum(counts[order]) <= MAX_OUT
                    pick = np.sort(order[ok])
                    parts, owner, counts = parts[pick], owner[pick], counts[pick]
                    truncated = True
                layer_of = np.asarray(rs.layer[ids[owner]])
                xy = np.round(shapely.get_coordinates(parts), DECIMALS)
                bounds = np.concatenate([[0], np.cumsum(counts)])
                grouped: dict[int, list[list[float]]] = {}
                for k in range(len(parts)):
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
    scale, turn = fitting.scale_of(t), fitting.rotation_of(t)
    labels = []
    for lab in _load_labels(folder):
        if not (box[0] <= lab["x"] <= box[2] and box[1] <= lab["y"] <= box[3]):
            continue
        height_site = lab["height"] * scale
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
