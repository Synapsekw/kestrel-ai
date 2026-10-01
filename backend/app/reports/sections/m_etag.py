"""Etag inputs for R9-M's sections (R2 protocol `fingerprint(ctx) -> str`, `app/reports/compose.py`):
what each section prints that R2's common fingerprint does not cover (`outline._data_fp` hashes
Source, GeoMap, Surface and PointCloud printed columns; the finding aggregate joins only sections
with USES_FINDINGS).

Bounded (spec §14, AGENTS "hot-path reads are bounded"): COUNT/MAX aggregates over the measurement
tables, and column digests of tens-of-rows tables (runs, surfaces, maps, site areas). Never a scan
of detections or boxes. Known gap: rejecting a box under a volume's detection mask turns that
volume stale (`volumes.service._kept_by_class`) without moving this etag unless the run's own
counts change; that aggregate is a scan of the run's boxes, so it stays out of the outline."""

from __future__ import annotations

import hashlib
import json

from sqlalchemy import func, select

from app.db.models import (
    CloudMeasurement,
    Finding,
    GeoMap,
    Job,
    MapMeasurement,
    MapRun,
    QueryRun,
    SiteArea,
    Surface,
    VolumeMeasurement,
)
from app.reports.context import ComposeContext


def _digest(s, stmt) -> str:
    """The statement's rows streamed into one hash (the tables here hold tens of rows)."""
    h = hashlib.sha256()
    for row in s.execute(stmt):
        h.update(json.dumps(list(row), default=str, sort_keys=True).encode())
    return h.hexdigest()


def _hash(payload) -> str:
    return hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode()).hexdigest()


def maps(s) -> str:
    """Map columns R9-M reads that `_data_fp` does not: the WGS84 footprint and the CRS (survey
    list, covering map, pair frames)."""
    return _digest(
        s, select(GeoMap.id, GeoMap.status, GeoMap.bounds_wgs84, GeoMap.crs_wkt).order_by(GeoMap.id)
    )


def measurements(ctx: ComposeContext) -> str:
    with ctx.session() as s:
        map_m = s.execute(select(func.count(), func.max(MapMeasurement.updated_at))).one()
        cloud_m = s.execute(select(func.count(), func.max(CloudMeasurement.updated_at))).one()
        volumes = s.execute(
            select(VolumeMeasurement.status, func.count(), func.max(VolumeMeasurement.updated_at))
            .group_by(VolumeMeasurement.status)
            .order_by(VolumeMeasurement.status)
        ).all()
        # What a volume's stale test reads (`volumes.service.inputs_snapshot`): the surfaces' jobs and
        # the runs its detection mask names, with their jobs' finish times.
        run_ids = sorted(
            {
                rid
                for (masks,) in s.execute(select(VolumeMeasurement.masks))
                for rid in (masks or {}).get("detection_run_ids", [])
            }
        )
        surfaces = _digest(s, select(Surface.id, Surface.status, Surface.job_id).order_by(Surface.id))
        runs = (
            _digest(
                s,
                select(MapRun.id, MapRun.job_id, MapRun.counts, MapRun.verified_counts, Job.finished_at)
                .outerjoin(Job, Job.id == MapRun.job_id)
                .where(MapRun.id.in_(run_ids))
                .order_by(MapRun.id),
            )
            if run_ids
            else ""
        )
        maps_digest = maps(s)
    return _hash(
        {
            "map": list(map_m),
            "cloud": list(cloud_m),
            "volume": [list(r) for r in volumes],
            "surfaces": surfaces,
            "mask_runs": [run_ids, runs],
            "maps": maps_digest,
        }
    )


def _counts_payload(ctx: ComposeContext, s) -> dict:
    map_runs = _digest(
        s,
        select(
            MapRun.id,
            MapRun.map_id,
            MapRun.kind,
            MapRun.scope,
            MapRun.model_id,
            MapRun.model_name,
            MapRun.conf,
            MapRun.pinned,
            MapRun.created_at,
            MapRun.counts,
            MapRun.verified_counts,
            MapRun.area_counts,
        ).order_by(MapRun.id),
    )
    query_runs = _digest(
        s,
        select(
            QueryRun.id,
            QueryRun.source_id,
            QueryRun.kind,
            QueryRun.model_id,
            QueryRun.model_name,
            QueryRun.conf,
            QueryRun.pinned,
            QueryRun.created_at,
            QueryRun.counts,
            QueryRun.verified_counts,
        ).order_by(QueryRun.id),
    )
    areas = _digest(
        s,
        select(
            SiteArea.id, SiteArea.name, SiteArea.category, SiteArea.created_at, SiteArea.polygon_wgs84
        ).order_by(SiteArea.id),
    )
    classes = [[c.get("id"), c.get("name"), c.get("colour")] for c in ctx.handle.row(s).classes]
    return {
        "map_runs": map_runs,
        "query_runs": query_runs,
        "areas": areas,
        "maps": maps(s),
        "classes": classes,
    }


def counts(ctx: ComposeContext) -> str:
    with ctx.session() as s:
        return _hash(_counts_payload(ctx, s))


def comparison(ctx: ComposeContext) -> str:
    """`counts` plus, per survey map, the findings' count and lon/lat sums: the pair frame centres on
    their mean (`survey_pairs.finding_centre`). One GROUP BY aggregate, tens of result rows."""
    surveys = select(GeoMap.id).where(GeoMap.status == "ready", GeoMap.bounds_wgs84.is_not(None))
    with ctx.session() as s:
        payload = _counts_payload(ctx, s)
        centres = s.execute(
            select(Finding.map_id, func.count(), func.total(Finding.lon), func.total(Finding.lat))
            .where(Finding.map_id.in_(surveys), Finding.lon.is_not(None), Finding.lat.is_not(None))
            .group_by(Finding.map_id)
            .order_by(Finding.map_id)
        ).all()
    return _hash({**payload, "centres": [list(r) for r in centres]})
