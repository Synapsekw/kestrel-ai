# backend/app/asset_models/cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4): one bounded cloud sample, a datum fit, per-item
heights and flags, and unregistered candidates. App code only; the AI reviews the outcome.

D5: the drawing decides plan position, the cloud decides height. Nothing here moves an item: a
disagreement becomes a flag. A cloud in another CRS, or with none, is skipped with a note and is
never reprojected.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError

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
    the header count) keeps at most `max_points` before the box filter, so memory is bounded by the
    cap, not the file. Raises LookError (fixed sentence) for a missing, unready or changed cloud and
    JobCancelled when `cancel()` turns true."""
    import laspy

    from app.asset_models.look.cloud import source_of
    from app.pointclouds import rows

    source = source_of(handle, cloud_id)
    row = rows.get_cloud(handle, cloud_id)
    x0, y0, x1, y1 = (float(v) for v in bbox_site)
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)) or x1 <= x0 or y1 <= y0:
        raise ValueError("bbox_site must be (xmin, ymin, xmax, ymax) with max > min")
    cap = max(1, min(int(max_points), MAX_POINTS))
    parts: list[np.ndarray] = []
    with laspy.open(str(source)) as reader:
        total = int(reader.header.point_count)
        stride = max(1, math.ceil(total / cap))
        done = 0
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
                if keep.any():
                    parts.append(np.column_stack([x[keep] - x0, y[keep] - y0, z[keep]]).astype(np.float32))
            done += n
            if progress is not None:
                progress(done, total)
    xyz = np.concatenate(parts) if parts else np.zeros((0, 3), np.float32)
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
        ix = ((xy[:, 0] - np.float32(self.lo[0])) / np.float32(self.CELL)).astype(np.int64)
        iy = ((xy[:, 1] - np.float32(self.lo[1])) / np.float32(self.CELL)).astype(np.int64)
        self.nx, self.ny = int(ix.max()) + 1, int(iy.max()) + 1
        key = iy * self.nx + ix
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
    span 200 m+ and a plane explains the spread clearly better). With fewer than 3 such items, the
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
    if len(a) >= 6 and math.hypot(np.ptp(a[:, 0]), np.ptp(a[:, 1])) >= 200.0:
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
