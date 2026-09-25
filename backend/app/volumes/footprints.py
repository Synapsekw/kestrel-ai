"""Detection footprints on a surface (spec 2026-09-23-volumes §6.5).

A detection run on the ortho of a flight marks where machines stand. Each box above the run's
confidence becomes its four corners in map pixels -> the map's CRS -> the surface's CRS (when they
differ) -> a shapely polygon buffered by `buffer_m`. The query is bounded by the measurement's
bbox, so there is no 5 000 cap in the job; a hard ceiling of 20 000 fails with a message.

The same function serves the job and `GET /volumes/{id}/footprints`, so what the operator sees is
exactly what was masked.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import Polygon
from sqlalchemy import select

from app.db.models import GeoMap, Job, MapDetection, MapRun
from app.maps.georef import Georef, box_corners
from app.projects.service import ProjectHandle

MAX_FOOTPRINTS = 20_000
DISPLAY_LIMIT = 5_000
BBOX_MARGIN_M = 5.0
EDGE_SAMPLES = 21


class FootprintError(Exception):
    """A run cannot be used for masking; the message names it for the operator."""


@dataclass(frozen=True)
class Footprint:
    run_id: str
    detection_id: str
    class_id: str
    polygon: Polygon  # surface CRS, buffered


def _run_label(run: MapRun, gmap: GeoMap | None) -> str:
    return f"run {run.model_name or run.provider or run.id[:8]} on {gmap.name if gmap else 'a deleted map'}"


def usable_runs(handle: ProjectHandle, run_ids: list[str]) -> list[tuple[MapRun, GeoMap, Job | None]]:
    """The runs, each checked: it must exist, its job must have succeeded and its map must have a
    CRS. Raises FootprintError naming the first run that fails."""
    out = []
    with handle.session() as s:
        for run_id in run_ids:
            run = s.get(MapRun, run_id)
            if run is None:
                raise FootprintError(f"run {run_id} no longer exists; remove it from the mask list")
            gmap = s.get(GeoMap, run.map_id)
            job = s.get(Job, run.job_id) if run.job_id else None
            if job is None or job.state != "succeeded":
                raise FootprintError(f"{_run_label(run, gmap)} has not finished; wait for it or untick it")
            if gmap is None or not gmap.crs_wkt or not gmap.geotransform:
                raise FootprintError(
                    f"{_run_label(run, gmap)} has no coordinates, so it cannot mask a surface"
                )
            s.expunge_all()
            out.append((run, gmap, job))
    return out


def _densified(bounds: tuple[float, float, float, float]) -> tuple[np.ndarray, np.ndarray]:
    minx, miny, maxx, maxy = bounds
    t = np.linspace(0.0, 1.0, EDGE_SAMPLES)
    xs = np.concatenate(
        [minx + t * (maxx - minx), minx + t * (maxx - minx), np.full_like(t, minx), np.full_like(t, maxx)]
    )
    ys = np.concatenate(
        [np.full_like(t, miny), np.full_like(t, maxy), miny + t * (maxy - miny), miny + t * (maxy - miny)]
    )
    return xs, ys


def footprints_for(
    handle: ProjectHandle,
    runs: list[tuple[MapRun, GeoMap, Job | None]],
    *,
    class_ids: list[str] | None,
    buffer_m: float,
    bbox: tuple[float, float, float, float],
    surface_crs_wkt: str | None,
    limit: int = MAX_FOOTPRINTS,
) -> tuple[list[Footprint], bool]:
    """Buffered footprints of the runs' boxes near `bbox` (surface CRS), and whether `limit` cut
    them short."""
    if not runs:
        return [], False
    if surface_crs_wkt is None:
        raise FootprintError("this surface has no coordinate system, so detections cannot be placed on it")
    surface_crs = CRS.from_user_input(surface_crs_wkt)
    margin = buffer_m + BBOX_MARGIN_M
    grown = (bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin)
    out: list[Footprint] = []
    for run, gmap, _ in runs:
        georef = Georef(gmap.geotransform, gmap.crs_wkt)
        map_crs = georef.crs
        same = map_crs.equals(surface_crs)
        to_map = None if same else Transformer.from_crs(surface_crs, map_crs, always_xy=True)
        to_surface = None if same else Transformer.from_crs(map_crs, surface_crs, always_xy=True)
        xs, ys = _densified(grown)
        if to_map is not None:
            xs, ys = to_map.transform(xs, ys)
        px, py = (~georef.affine) @ (np.asarray(xs), np.asarray(ys))
        px0, px1, py0, py1 = float(np.min(px)), float(np.max(px)), float(np.min(py)), float(np.max(py))
        query = select(MapDetection).where(
            MapDetection.run_id == run.id,
            MapDetection.confidence >= run.conf,
            MapDetection.review_state != "rejected",  # a person said there is no machine there
            MapDetection.x <= px1,
            MapDetection.y <= py1,
            MapDetection.x + MapDetection.w >= px0,
            MapDetection.y + MapDetection.h >= py0,
        )
        if class_ids is not None:
            query = query.where(MapDetection.class_id.in_(class_ids))
        with handle.session() as s:
            rows = s.execute(query.limit(limit - len(out) + 1)).scalars().all()
            s.expunge_all()
        for d in rows:
            if len(out) >= limit:
                return out, True
            ring = [georef.pixel_to_native(x, y) for x, y in box_corners(d.x, d.y, d.w, d.h, d.angle)]
            if to_surface is not None:
                rx, ry = to_surface.transform([p[0] for p in ring], [p[1] for p in ring])
                ring = list(zip(rx, ry, strict=True))
            out.append(Footprint(run.id, d.id, d.class_id, Polygon(ring).buffer(buffer_m)))
    return out, False
