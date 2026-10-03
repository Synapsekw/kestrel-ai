# backend/app/asset_models/cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4): one bounded cloud sample, a datum fit, per-item
heights and flags, and unregistered candidates. App code only; the AI reviews the outcome.

D5: the drawing decides plan position, the cloud decides height. Nothing here moves an item: a
disagreement becomes a flag. A cloud in another CRS, or with none, is skipped with a note and is
never reprojected.
"""

from __future__ import annotations

import math
import warnings
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError
from scipy import ndimage, signal

from app.asset_models.siteframe import PlantGrid, footprint_polygon, footprint_ref
from app.asset_models.spec import CloudDatum, Item, ItemFlag, SiteCrs, SiteFrame
from app.jobs.cancellation import JobCancelled

MAX_POINTS = 20_000_000  # plant sample cap (index: bounded reads)
CHUNK = 2_000_000  # laspy chunk; read at call time so tests can shrink it
ITEM_CAP = 200_000  # per-item cloud work cap
HEIGHT_TOL_M = 0.5
PLAN_TOL_M = 1.0
ABOVE_ITEM_M = 0.3  # a point this far above the local ground counts as "something there"
ABOVE_CAND_M = 1.0  # stricter for candidates, which have no footprint to anchor them
RING_M = 5.0  # ground ring around a footprint
SEARCH_M = 4.0  # best-fit shift search radius
WINDOW_CELLS = 10_000  # raster cells per item window (the cell grows for big items)
COVER_CELL_M = 2.0
COVER_MIN = 0.5
OCCUPANCY_MAX = 0.1
CAND_MIN_M = 3.0
CAND_CELL_M = 1.0
CAND_PTS_PER_CELL = 4.0  # a sparse sample gets bigger cells, so 2 hits per occupied cell stay likely
CAND_BLOCK = 10  # ground blocks of 10 x 10 candidate cells
CAND_EXCLUDE_M = 2.0  # footprints grow this much before clusters are tested against them
CAND_LIMIT = 200
CAND_MAX_GRID = 16_000_000
MISSING_MIN_EXPECTED = 20  # sample points the footprint should hold before "nothing there" is believed
TILT_MIN_WIDTH_M = 50.0  # items narrower than this across their main axis cannot fix a cross tilt
CLOUD_CODES = frozenset({"plan_offset", "height_mismatch", "missing_in_cloud"})
# Types with no body above grade: only coverage is reported for them.
NO_BODY_TYPES = frozenset(
    {
        "road",
        "paved",
        "laydown",
        "parking",
        "trench",
        "channel",
        "basin",
        "revetment",
        "fence",
        "pipe_sleeper",
    }
)
SKIP_OTHER_CRS = (
    "The point cloud is in a different coordinate system from the site, so the cloud check skipped it: "
    "no heights and no flags. It was not reprojected."
)
SKIP_NO_CRS = (
    "The point cloud or the site has no coordinate system, so the cloud check skipped it: no heights and "
    "no flags."
)
NO_POINTS = "The point cloud has no points inside the plant extent."
NO_DATUM = "No cloud datum could be fitted: item heights are not given and candidate tops are cloud z."
UNREADABLE = "That point cloud's file could not be read: it may be damaged or incomplete."


@dataclass
class PlantSample:
    """A bounded plant-extent sample. `xyz` is float32: site x, y relative to `origin` (float32 cannot
    hold UTM metres to the centimetre), and the cloud's own z."""

    xyz: np.ndarray
    cloud_id: str
    crs_epsg: int | None
    bbox: tuple[float, float, float, float]
    crs_wkt: str | None = None
    origin: tuple[float, float] = (0.0, 0.0)
    total: int = 0
    _index: _Index | None = field(default=None, repr=False, compare=False)

    def site_xy(self, idx=slice(None)) -> np.ndarray:
        return self.xyz[idx, :2].astype(np.float64) + np.asarray(self.origin, dtype=np.float64)

    def save(self, path: Path) -> None:
        """An .npz the run keeps, so a resumed run does not read the cloud again."""
        tmp = path.with_name(path.name + ".tmp.npz")
        np.savez(
            tmp,
            xyz=self.xyz,
            bbox=np.asarray(self.bbox, dtype=np.float64),
            origin=np.asarray(self.origin, dtype=np.float64),
            total=np.array([self.total]),
            epsg=np.array([-1 if self.crs_epsg is None else int(self.crs_epsg)]),
            text=np.array([self.cloud_id, self.crs_wkt or ""]),
        )
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> PlantSample:
        with np.load(path) as d:
            epsg = int(d["epsg"][0])
            cloud_id, wkt = (str(v) for v in d["text"])
            return cls(
                xyz=d["xyz"],
                cloud_id=cloud_id,
                crs_epsg=None if epsg < 0 else epsg,
                bbox=tuple(float(v) for v in d["bbox"]),
                crs_wkt=wkt or None,
                origin=tuple(float(v) for v in d["origin"]),
                total=int(d["total"][0]),
            )

    def index(self) -> _Index:
        if self._index is None:
            self._index = _Index(self.xyz[:, :2])
        return self._index


@dataclass
class ItemCheck:
    item_id: str
    ground_el: float | None
    top_el: float | None
    coverage: float
    offset_m: float | None
    flags: list[ItemFlag]


@dataclass
class Candidate:
    id: str
    pts: list[tuple[float, float]]
    top_el: float
    size_m: tuple[float, float]


@dataclass
class CheckResult:
    datum: CloudDatum | None
    items: dict[str, ItemCheck]
    candidates: list[Candidate]
    note: str | None = None


# ---------------------------------------------------------------- CRS


def same_crs(epsg: int | None, wkt: str | None, crs: SiteCrs) -> bool:
    """True only when the cloud's CRS is the site's. Unknown on either side is never the same."""
    if epsg is not None and crs.epsg is not None:
        return int(epsg) == int(crs.epsg)
    try:
        a = CRS.from_wkt(wkt) if wkt else (CRS.from_epsg(epsg) if epsg is not None else None)
        b = CRS.from_wkt(crs.wkt) if crs.wkt else (CRS.from_epsg(crs.epsg) if crs.epsg is not None else None)
    except CRSError:
        return False
    return a is not None and b is not None and a.equals(b, ignore_axis_order=True)


def cloud_in_frame(handle, cloud_id: str, frame: SiteFrame) -> bool:
    """Whether a cloud can be checked against this site frame at all (R1 asks before sampling)."""
    from app.pointclouds import rows

    row = rows.get_cloud(handle, cloud_id)
    return same_crs(row.epsg, row.crs_wkt, frame.crs)


def _skip_note(sample: PlantSample, frame: SiteFrame) -> str | None:
    if same_crs(sample.crs_epsg, sample.crs_wkt, frame.crs):
        return None
    known_cloud = sample.crs_epsg is not None or bool(sample.crs_wkt)
    known_site = frame.crs.epsg is not None or bool(frame.crs.wkt)
    return SKIP_OTHER_CRS if known_cloud and known_site else SKIP_NO_CRS


# ---------------------------------------------------------------- sample


def plant_bbox_site(
    grid: PlantGrid, items: list[Item], margin_m: float = 50.0
) -> tuple[float, float, float, float] | None:
    """The site-CRS box around every item footprint, grown by `margin_m`; None without a usable item."""
    rings = []
    for it in items:
        try:
            ring = np.asarray(footprint_polygon(it.footprint), dtype=np.float64)
        except (ValueError, ArithmeticError):
            continue
        if len(ring) and np.isfinite(ring).all():
            rings.append(ring)
    if not rings:
        return None
    pts = np.concatenate(rings)
    x, y = grid.plant_to_site(pts[:, 0], pts[:, 1])
    return (
        float(x.min() - margin_m),
        float(y.min() - margin_m),
        float(x.max() + margin_m),
        float(y.max() + margin_m),
    )


def sample_plant_cloud(
    handle,
    cloud_id: str,
    bbox_site: tuple[float, float, float, float],
    *,
    max_points: int = MAX_POINTS,
    cancel: Callable[[], bool] | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> PlantSample:
    """One streamed laspy pass in <= CHUNK-point chunks. Uniform decimation (every k-th point, k from
    the header count) keeps at most `max_points` before the box filter, in one preallocated float32
    buffer, so memory is bounded by the cap, not the file. Raises LookError (fixed sentence) for a
    missing, unready, changed or unreadable cloud and JobCancelled when `cancel()` turns true."""
    import laspy

    from app.asset_models.look import LookError
    from app.asset_models.look.cloud import source_of
    from app.pointclouds import rows

    source = source_of(handle, cloud_id)
    row = rows.get_cloud(handle, cloud_id)
    x0, y0, x1, y1 = (float(v) for v in bbox_site)
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)) or x1 <= x0 or y1 <= y0:
        raise ValueError("bbox_site must be (xmin, ymin, xmax, ymax) with max > min")
    cap = max(1, min(int(max_points), MAX_POINTS))
    try:
        with laspy.open(str(source)) as reader:
            total = int(reader.header.point_count)
            stride = max(1, math.ceil(total / cap))
            buf = np.empty((min(cap, -(-total // stride)), 3), np.float32)
            kept = done = 0
            for chunk in reader.chunk_iterator(CHUNK):
                if cancel is not None and cancel():
                    raise JobCancelled()
                n = len(chunk)
                sel = np.arange((-done) % stride, n, stride)
                if len(sel):
                    x = np.asarray(chunk.x)[sel]
                    y = np.asarray(chunk.y)[sel]
                    z = np.asarray(chunk.z)[sel]
                    keep = (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
                    m = min(int(keep.sum()), len(buf) - kept)  # never past the cap, even if the header lies
                    if m:
                        dst = buf[kept : kept + m]
                        dst[:, 0] = x[keep][:m] - x0
                        dst[:, 1] = y[keep][:m] - y0
                        dst[:, 2] = z[keep][:m]
                        kept += m
                done += n
                if progress is not None:
                    progress(done, total)
    except (JobCancelled, MemoryError):
        raise
    except Exception:  # laspy / lazrs messages can carry the local path: a fixed sentence only
        raise LookError(UNREADABLE) from None
    if done < total:
        raise LookError(UNREADABLE)  # fewer points than the header says: a truncated file
    xyz = buf[:kept]
    if progress is not None:
        progress(total, total)
    return PlantSample(
        xyz=xyz,
        cloud_id=cloud_id,
        crs_epsg=row.epsg,
        bbox=(x0, y0, x1, y1),
        crs_wkt=row.crs_wkt,
        origin=(x0, y0),
        total=total,
    )


# ---------------------------------------------------------------- spatial index and item windows


class _Index:
    """Sample points bucketed on a 10 m site grid, so a box query never scans the whole sample."""

    CELL = 10.0

    def __init__(self, xy: np.ndarray):
        self.n = len(xy)
        if self.n == 0:
            self.nx = self.ny = 0
            return
        self.lo = xy.min(axis=0).astype(np.float64)
        ix = ((xy[:, 0] - np.float32(self.lo[0])) / np.float32(self.CELL)).astype(np.int32)
        iy = ((xy[:, 1] - np.float32(self.lo[1])) / np.float32(self.CELL)).astype(np.int32)
        self.nx, self.ny = int(ix.max()) + 1, int(iy.max()) + 1
        key = iy.astype(np.int64)  # the one transient int64 array, built in place
        key *= self.nx
        key += ix
        del ix, iy
        self.order = np.argsort(key, kind="stable").astype(np.int32 if self.n < 2**31 else np.int64)
        self.starts = np.concatenate([[0], np.cumsum(np.bincount(key, minlength=self.nx * self.ny))])

    def query(self, x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
        """Indices of points in the cells overlapping the box (coordinates relative to the sample)."""
        if self.n == 0:
            return np.zeros(0, np.int64)
        i0 = math.floor((x0 - self.lo[0]) / self.CELL)
        i1 = math.floor((x1 - self.lo[0]) / self.CELL)
        j0 = math.floor((y0 - self.lo[1]) / self.CELL)
        j1 = math.floor((y1 - self.lo[1]) / self.CELL)
        if i1 < 0 or j1 < 0 or i0 >= self.nx or j0 >= self.ny:
            return np.zeros(0, np.int64)
        i0, i1 = max(i0, 0), min(i1, self.nx - 1)
        j0, j1 = max(j0, 0), min(j1, self.ny - 1)
        parts = [
            self.order[self.starts[j * self.nx + i0] : self.starts[j * self.nx + i1 + 1]]
            for j in range(j0, j1 + 1)
        ]
        return np.concatenate(parts).astype(np.int64) if parts else np.zeros(0, np.int64)


def _poly(item: Item):
    ring = np.asarray(footprint_polygon(item.footprint), dtype=np.float64)
    if len(ring) < 3 or not np.isfinite(ring).all():
        return None
    poly = shapely.make_valid(shapely.Polygon(ring))
    if poly.is_empty or poly.area < 0.01:
        return None
    return poly


@dataclass
class _Local:
    poly: object
    window: tuple[float, float, float, float]  # plant [E, N] box: footprint bounds grown by the margin
    e: np.ndarray
    n: np.ndarray
    z: np.ndarray
    inside: np.ndarray
    ref_site: tuple[float, float]


def _local(sample: PlantSample, grid: PlantGrid, item: Item, margin: float) -> _Local | None:
    poly = _poly(item)
    if poly is None:
        return None
    a0, b0, a1, b1 = poly.bounds
    win = (a0 - margin, b0 - margin, a1 + margin, b1 + margin)
    cx, cy = grid.plant_to_site(
        np.array([win[0], win[2], win[2], win[0]]), np.array([win[1], win[1], win[3], win[3]])
    )
    ox, oy = sample.origin
    idx = sample.index().query(cx.min() - ox, cy.min() - oy, cx.max() - ox, cy.max() - oy)
    if len(idx) > ITEM_CAP:
        idx = idx[:: math.ceil(len(idx) / ITEM_CAP)]
    xy = sample.site_xy(idx)
    e, n = grid.site_to_plant(xy[:, 0], xy[:, 1])
    e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
    z = sample.xyz[idx, 2].astype(np.float64)
    keep = (e >= win[0]) & (e <= win[2]) & (n >= win[1]) & (n <= win[3])
    e, n, z = e[keep], n[keep], z[keep]
    inside = shapely.contains_xy(poly, e, n) if len(e) else np.zeros(0, bool)
    re_, rn = footprint_ref(item.footprint)
    rx, ry = grid.plant_to_site(np.array([re_]), np.array([rn]))
    return _Local(poly, win, e, n, z, inside, (float(rx[0]), float(ry[0])))


def _el_offset(datum: CloudDatum, frame: SiteFrame, x: float, y: float) -> float:
    """plant EL = cloud z + this, at site (x, y)."""
    off = float(datum.offset_m)
    if datum.tilt is not None:
        off += datum.tilt[0] * (x - frame.origin_crs[0]) + datum.tilt[1] * (y - frame.origin_crs[1])
    return off


# ---------------------------------------------------------------- datum


def fit_datum(sample: PlantSample, grid: PlantGrid, items: list[Item]) -> CloudDatum | None:
    """plant EL = cloud z + offset_m (+ tilt . [x - origin_x, y - origin_y]).

    From the ground ring around items with drawing base elevations (median; a tilt when 6+ of them
    span 200 m+, spread at least TILT_MIN_WIDTH_M across their main axis, and a plane explains the
    spread clearly better). With fewer than 3 such items, the
    median base_el of every item that has one, against the sample's 5th z percentile. Else None.
    """
    frame = grid.frame
    if _skip_note(sample, frame) is not None or len(sample.xyz) == 0:
        return None
    pairs: list[tuple[float, float, float]] = []
    for it in items:
        if it.height_source != "drawing" or it.base_el is None:
            continue
        try:
            loc = _local(sample, grid, it, RING_M)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            continue
        if loc is None:
            continue
        outside = loc.z[~loc.inside]
        if len(outside) < 20:
            continue
        pairs.append((loc.ref_site[0], loc.ref_site[1], it.base_el - float(np.percentile(outside, 10))))
    if len(pairs) >= 3:
        return _fit_offsets(np.asarray(pairs), frame, sample.cloud_id)
    bases = [it.base_el for it in items if it.base_el is not None]
    if len(bases) >= 3:
        ground_z = float(np.percentile(sample.xyz[:, 2], 5))
        return CloudDatum(cloud_id=sample.cloud_id, offset_m=round(float(np.median(bases)) - ground_z, 3))
    return None


def _fit_offsets(a: np.ndarray, frame: SiteFrame, cloud_id: str) -> CloudDatum:
    off = a[:, 2]
    med = float(np.median(off))
    if (
        len(a) >= 6
        and math.hypot(np.ptp(a[:, 0]), np.ptp(a[:, 1])) >= 200.0
        and _minor_width(a[:, :2]) >= TILT_MIN_WIDTH_M
    ):
        A = np.column_stack([np.ones(len(a)), a[:, 0] - frame.origin_crs[0], a[:, 1] - frame.origin_crs[1]])
        sol = np.linalg.lstsq(A, off, rcond=None)[0]
        r_plane = float(np.sqrt(np.mean((off - A @ sol) ** 2)))
        r_const = float(np.sqrt(np.mean((off - med) ** 2)))
        if r_const > 0.05 and r_plane < 0.7 * r_const:
            return CloudDatum(
                cloud_id=cloud_id,
                offset_m=round(float(sol[0]), 3),
                tilt=(round(float(sol[1]), 7), round(float(sol[2]), 7)),
            )
    return CloudDatum(cloud_id=cloud_id, offset_m=round(med, 3))


def _minor_width(xy: np.ndarray) -> float:
    """How far the points spread across their main axis: the ptp of the centred points projected on
    the minor principal axis. Near-collinear items leave a plane's cross tilt undetermined."""
    c = xy - xy.mean(axis=0)
    vt = np.linalg.svd(c, full_matrices=False)[2]
    return float(np.ptp(c @ vt[-1]))


# ---------------------------------------------------------------- per item


def _raster(loc: _Local, cell: float, pick: np.ndarray | None = None):
    """(hit grid of the picked points, footprint mask of cell centres) on the window at `cell` metres."""
    e0, n0, e1, n1 = loc.window
    w = max(1, math.ceil((e1 - e0) / cell))
    h = max(1, math.ceil((n1 - n0) / cell))
    hit = np.zeros((h, w), bool)
    sel = np.ones(len(loc.e), bool) if pick is None else pick
    cols = np.clip(((loc.e[sel] - e0) / cell).astype(np.int64), 0, w - 1)
    rows_ = np.clip(((loc.n[sel] - n0) / cell).astype(np.int64), 0, h - 1)
    hit[rows_, cols] = True
    ce, cn = np.meshgrid(e0 + (np.arange(w) + 0.5) * cell, n0 + (np.arange(h) + 0.5) * cell)
    mask = shapely.contains_xy(loc.poly, ce, cn)
    return hit, mask


def _best_shift(occ: np.ndarray, mask: np.ndarray, cell: float) -> tuple[float, float] | None:
    """The (dE, dN) shift of the footprint mask that best covers the occupied cells, within SEARCH_M.
    Ties go to the smallest shift. None when too little of the cloud matches any shift."""
    m = int(mask.sum())
    if m == 0 or int(occ.sum()) < 4:
        return None
    h, w = mask.shape
    s = min(max(1, math.ceil(SEARCH_M / cell)), h - 1, w - 1)
    if s < 1:
        return None
    corr = signal.correlate(occ.astype(np.float32), mask.astype(np.float32), mode="full", method="fft")
    sub = corr[h - 1 - s : h + s, w - 1 - s : w + s]
    best = float(sub.max())
    if best < max(4.0, 0.2 * m):
        return None
    dy, dx = np.mgrid[-s : s + 1, -s : s + 1]
    norms = np.hypot(dy, dx).astype(np.float64)
    norms[sub < best - 0.5] = np.inf
    k = np.unravel_index(int(np.argmin(norms)), norms.shape)
    return float(dx[k] * cell), float(dy[k] * cell)


def _check_one(
    sample: PlantSample, grid: PlantGrid, item: Item, datum: CloudDatum | None
) -> ItemCheck | None:
    loc = _local(sample, grid, item, max(RING_M, SEARCH_M))
    if loc is None:
        return None
    if len(loc.z) == 0:
        return ItemCheck(item.id, None, None, 0.0, None, [])
    e0, n0, e1, n1 = loc.window
    cell = max(0.5, math.sqrt((e1 - e0) * (n1 - n0) / WINDOW_CELLS))
    cover_cell = max(cell, COVER_CELL_M)
    any_hit, _ = _raster(loc, cover_cell)
    coverage = round(float(any_hit.mean()), 3)
    outside = loc.z[~loc.inside]
    ground_z = float(np.percentile(outside, 10)) if len(outside) >= 20 else None
    el_off = _el_offset(datum, grid.frame, *loc.ref_site) if datum is not None else None
    ground_el = round(ground_z + el_off, 2) if ground_z is not None and el_off is not None else None
    if item.type in NO_BODY_TYPES or ground_z is None:
        return ItemCheck(item.id, ground_el, None, coverage, None, [])
    above = loc.z > ground_z + ABOVE_ITEM_M
    in_above = above & loc.inside
    top_z = float(np.percentile(loc.z[in_above], 98)) if int(in_above.sum()) >= 10 else None
    top_el = round(top_z + el_off, 2) if top_z is not None and el_off is not None else None
    hit2, mask2 = _raster(loc, cover_cell, in_above)
    cells = int(mask2.sum())
    occupancy = float((hit2 & mask2).sum()) / cells if cells else (1.0 if int(in_above.sum()) >= 3 else 0.0)
    # A sparse sample can miss a small body entirely: "missing" needs enough points expected in it.
    expected = len(loc.z) / max((e1 - e0) * (n1 - n0), 1e-9) * float(loc.poly.area)
    flags: list[ItemFlag] = []
    offset_m = None
    if coverage >= COVER_MIN and occupancy < OCCUPANCY_MAX and expected >= MISSING_MIN_EXPECTED:
        flags.append(
            ItemFlag(
                code="missing_in_cloud",
                value=round(occupancy, 3),
                note="The scan covers this footprint but nothing stands above the ground in it.",
            )
        )
    else:
        occ, mask = _raster(loc, cell, above)
        shift = _best_shift(occ, mask, cell)
        if shift is not None:
            de, dn = shift
            offset_m = round(math.hypot(de, dn), 2)
            if offset_m > PLAN_TOL_M:
                flags.append(
                    ItemFlag(
                        code="plan_offset",
                        value=offset_m,
                        note=f"The cloud fits best {de:+.1f} m east, {dn:+.1f} m north of the drawn "
                        "position. The position is kept as drawn.",
                    )
                )
    if (
        item.height_source == "drawing"
        and item.top_el is not None
        and top_el is not None
        and abs(top_el - item.top_el) > HEIGHT_TOL_M
    ):
        flags.append(
            ItemFlag(
                code="height_mismatch",
                value=round(top_el - item.top_el, 2),
                note=f"Cloud top EL {top_el:.2f} against drawing top EL {item.top_el:.2f}.",
            )
        )
    return ItemCheck(item.id, ground_el, top_el, coverage, offset_m, flags)


def check_items(
    sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None
) -> CheckResult:
    frame = grid.frame
    skip = _skip_note(sample, frame)
    if skip is not None:
        return CheckResult(None, {}, [], note=skip)
    if datum is not None and datum.cloud_id != sample.cloud_id:
        datum = None
    if len(sample.xyz) == 0:
        return CheckResult(datum, {}, [], note=NO_POINTS)
    out: dict[str, ItemCheck] = {}
    for it in items:
        try:
            chk = _check_one(sample, grid, it, datum)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            chk = None  # one unreadable footprint never stops the check (the validator reports it)
        if chk is not None:
            out[it.id] = chk
    cands = _candidates(sample, grid, items, datum)
    return CheckResult(datum, out, cands, note=None if datum is not None else NO_DATUM)


# ---------------------------------------------------------------- unregistered candidates


def _cells(sample: PlantSample, grid: PlantGrid, e0: float, n0: float, cell: float, w: int, h: int):
    """(flat cell index, z) per point, in CHUNK-sized slices of the sample."""
    for s in range(0, len(sample.xyz), CHUNK):
        sl = slice(s, s + CHUNK)
        xy = sample.site_xy(sl)
        e, n = grid.site_to_plant(xy[:, 0], xy[:, 1])
        c = np.floor((np.asarray(e) - e0) / cell).astype(np.int64)
        r = np.floor((np.asarray(n) - n0) / cell).astype(np.int64)
        ok = (c >= 0) & (c < w) & (r >= 0) & (r < h)
        yield r[ok] * w + c[ok], sample.xyz[sl, 2][ok]


def _footprint_mask(items: list[Item], e0: float, n0: float, cell: float, h: int, w: int) -> np.ndarray:
    m = np.zeros((h, w), bool)
    for it in items:
        if it.type in NO_BODY_TYPES:
            continue  # a road or a paved area does not account for what stands on it
        try:
            poly = _poly(it)
        except (ValueError, ArithmeticError, shapely.errors.ShapelyError):
            continue
        if poly is None:
            continue
        grown = poly.buffer(CAND_EXCLUDE_M)
        a0, b0, a1, b1 = grown.bounds
        c0, c1 = max(0, int((a0 - e0) // cell)), min(w - 1, int((a1 - e0) // cell))
        r0, r1 = max(0, int((b0 - n0) // cell)), min(h - 1, int((b1 - n0) // cell))
        if c1 < c0 or r1 < r0:
            continue
        ce, cn = np.meshgrid(
            e0 + (np.arange(c0, c1 + 1) + 0.5) * cell, n0 + (np.arange(r0, r1 + 1) + 0.5) * cell
        )
        m[r0 : r1 + 1, c0 : c1 + 1] |= shapely.contains_xy(grown, ce, cn)
    return m


def _candidates(
    sample: PlantSample, grid: PlantGrid, items: list[Item], datum: CloudDatum | None
) -> list[Candidate]:
    """Connected above-ground cell clusters at least CAND_MIN_M x CAND_MIN_M that no footprint covers."""
    x0, y0, x1, y1 = sample.bbox
    ce, cn = grid.site_to_plant(np.array([x0, x1, x1, x0]), np.array([y0, y0, y1, y1]))
    e0, n0 = float(np.min(ce)), float(np.min(cn))
    span_e, span_n = float(np.max(ce)) - e0, float(np.max(cn)) - n0
    area = max((x1 - x0) * (y1 - y0), 1.0)
    cell = max(CAND_CELL_M, math.sqrt(CAND_PTS_PER_CELL / max(len(sample.xyz) / area, 1e-9)))
    if (span_e / cell) * (span_n / cell) > CAND_MAX_GRID:
        cell = math.sqrt(span_e * span_n / CAND_MAX_GRID)
    w, h = int(span_e // cell) + 1, int(span_n // cell) + 1
    cmin = np.full(h * w, np.inf, np.float32)
    for k, z in _cells(sample, grid, e0, n0, cell, w, h):
        np.minimum.at(cmin, k, z)
    b = CAND_BLOCK
    hb, wb = -(-h // b), -(-w // b)
    pad = np.full((hb * b, wb * b), np.nan, np.float32)
    pad[:h, :w] = np.where(np.isfinite(cmin), cmin, np.nan).reshape(h, w)
    blocks = pad.reshape(hb, b, wb, b).transpose(0, 2, 1, 3).reshape(hb, wb, b * b)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-empty blocks give NaN, filled below
        gb = np.nanpercentile(blocks, 10, axis=2)
    holes = np.isnan(gb)
    if holes.all():
        return []
    if holes.any():
        near = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
        gb = gb[tuple(near)]
    gb = ndimage.minimum_filter(gb, size=3, mode="nearest")
    ground = np.repeat(np.repeat(gb, b, axis=0), b, axis=1)[:h, :w].ravel()
    cnt = np.zeros(h * w, np.int64)
    cmax = np.full(h * w, -np.inf, np.float32)
    for k, z in _cells(sample, grid, e0, n0, cell, w, h):
        up = z > ground[k] + ABOVE_CAND_M
        cnt += np.bincount(k[up], minlength=h * w)
        np.maximum.at(cmax, k[up], z[up])
    occ = (cnt >= 2).reshape(h, w) & ~_footprint_mask(items, e0, n0, cell, h, w)
    lab, _ = ndimage.label(occ, structure=np.ones((3, 3), bool))
    cmax = cmax.reshape(h, w)
    found: list[tuple[int, Candidate]] = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        size_n = (sl[0].stop - sl[0].start) * cell
        size_e = (sl[1].stop - sl[1].start) * cell
        if size_e < CAND_MIN_M - 1e-9 or size_n < CAND_MIN_M - 1e-9:
            continue
        rr, cc = np.nonzero(lab[sl] == i)
        rr, cc = rr + sl[0].start, cc + sl[1].start
        e = e0 + cc * cell
        n = n0 + rr * cell
        corners = np.concatenate(
            [np.column_stack([e + de, n + dn]) for de in (0.0, cell) for dn in (0.0, cell)]
        )
        hull = shapely.MultiPoint(corners).convex_hull
        ring = list(hull.exterior.coords)[:-1] if hull.geom_type == "Polygon" else list(hull.coords)
        top_z = float(np.percentile(cmax[rr, cc], 98))
        if datum is not None:
            sx, sy = grid.plant_to_site(np.array([e.mean() + cell / 2]), np.array([n.mean() + cell / 2]))
            top_z += _el_offset(datum, grid.frame, float(sx[0]), float(sy[0]))
        found.append(
            (
                len(rr),
                Candidate(
                    id="",
                    pts=[(round(float(a), 2), round(float(c), 2)) for a, c in ring[:500]],
                    top_el=round(top_z, 2),
                    size_m=(round(size_e, 1), round(size_n, 1)),
                ),
            )
        )
    found.sort(key=lambda t: -t[0])
    out = [c for _, c in found[:CAND_LIMIT]]
    for k, c in enumerate(out, start=1):
        c.id = f"cand-{k:03d}"
    return out


# ---------------------------------------------------------------- applying and reporting


def apply_check(items: list[Item], result: CheckResult) -> list[Item]:
    """Heights where the item's are indicative, or came from an earlier cloud check, become this
    check's cloud heights; drawing heights are never changed. Cloud flags are replaced by this
    check's. Footprints, ids and every other field are never changed (D5)."""
    out: list[Item] = []
    for it in items:
        chk = result.items.get(it.id)
        if chk is None:
            out.append(it)
            continue
        update: dict = {"flags": [f for f in it.flags if f.code not in CLOUD_CODES] + list(chk.flags)}
        if (
            it.height_source in ("indicative", "cloud")
            and chk.ground_el is not None
            and chk.top_el is not None
            and chk.top_el > chk.ground_el
        ):
            update.update(base_el=chk.ground_el, top_el=chk.top_el, height_source="cloud")
        out.append(it.model_copy(update=update))
    return out


def summarise(result: CheckResult, *, limit: int = 300) -> dict:
    """A bounded, JSON-ready digest for the run (the cloud_check tool's reply): flagged items first."""
    counts = Counter(f.code for c in result.items.values() for f in c.flags)
    rows = sorted(result.items.values(), key=lambda c: (not c.flags, c.item_id))
    return {
        "datum": None if result.datum is None else result.datum.model_dump(),
        "note": result.note,
        "checked": len(result.items),
        "flag_counts": dict(sorted(counts.items())),
        "items": [
            {
                "id": c.item_id,
                "ground_el": c.ground_el,
                "top_el": c.top_el,
                "coverage": c.coverage,
                "offset_m": c.offset_m,
                "flags": [{"code": f.code, "value": f.value, "note": f.note} for f in c.flags],
            }
            for c in rows[:limit]
        ],
        "truncated": len(rows) > limit,
        "candidates": [
            {"id": c.id, "size_m": list(c.size_m), "top_el": c.top_el, "pts": [list(p) for p in c.pts[:64]]}
            for c in result.candidates[:50]
        ],
        "candidates_total": len(result.candidates),
    }
