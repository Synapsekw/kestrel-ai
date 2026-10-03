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
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.asset_models.siteframe import PlantGrid, footprint_polygon
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
