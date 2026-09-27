"""Survey dates for the timeline scrubber and the date chips (spec 2026-09-26-map-workspace sections
5 and 12, `listWorkspaceSurveys`): ready maps and dated elevation (cloud DSM, DEM) in the current
frame, grouped by (date, date_is_import_date) (plan deviation 11), plus the planned dates."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select

from app.db.models import GeoMap, Job, MapRun, PointCloud, Surface
from app.projects.service import ProjectHandle
from app.workspace.layers import map_date, surface_date
from app.workspace.schemas import WorkspaceSurveyMapOut, WorkspaceSurveyOut, WorkspaceSurveySurfaceOut
from app.workspace.service import load


def _basis_runs(s) -> dict[str, str]:
    """Ruling R-B1-9: per map, the pinned run, else the newest finished run; never a region run."""
    rows = s.execute(
        select(MapRun.id, MapRun.map_id, MapRun.pinned, MapRun.created_at)
        .join(Job, Job.id == MapRun.job_id)
        .where(MapRun.scope != "region", Job.state == "succeeded")
    ).all()
    basis: dict[str, str] = {}
    for run_id, map_id, _, _ in sorted(rows, key=lambda r: (bool(r.pinned), r.created_at)):
        basis[map_id] = run_id  # the last one wins: pinned after unpinned, newest last
    return basis


def list_surveys(handle: ProjectHandle) -> list[WorkspaceSurveyOut]:
    ws = load(handle)
    frame = ws.frame
    buckets: dict[tuple[date, bool], WorkspaceSurveyOut] = {}

    def bucket(d: date, imported: bool) -> WorkspaceSurveyOut:
        key = (d, imported)
        if key not in buckets:
            buckets[key] = WorkspaceSurveyOut(
                date=d, date_is_import_date=imported, planned=False, note=None, maps=[], surfaces=[]
            )
        return buckets[key]

    with handle.session() as s:
        basis = _basis_runs(s)
        maps = s.execute(
            select(GeoMap).where(GeoMap.status == "ready", GeoMap.crs_wkt.is_not(None))
        ).scalars()
        for m in sorted(maps, key=lambda m: m.created_at):
            if frame.holds(m.crs_wkt):
                d, imported = map_date(m)
                bucket(d, imported).maps.append(
                    WorkspaceSurveyMapOut(id=m.id, name=m.name, gsd_cm=m.gsd_cm, basis_run_id=basis.get(m.id))
                )
        clouds = dict(s.execute(select(PointCloud.id, PointCloud.captured_on)).all())
        rows = s.execute(
            select(Surface).where(Surface.status == "ready", Surface.kind.in_(("cloud_dsm", "dem")))
        )
        for row in sorted(rows.scalars(), key=lambda r: r.created_at):
            if frame.holds(row.crs_wkt):
                d, imported = surface_date(row, clouds.get(row.point_cloud_id))
                bucket(d, imported).surfaces.append(
                    WorkspaceSurveySurfaceOut(
                        id=row.id, name=row.name, kind=row.kind, elevation_role=row.elevation_role
                    )
                )
    real = {d for d, imported in buckets if not imported}
    out = list(buckets.values())
    for p in ws.planned_surveys:
        d = date.fromisoformat(p["date"])
        if d not in real:
            out.append(
                WorkspaceSurveyOut(
                    date=d, date_is_import_date=False, planned=True, note=p.get("note"), maps=[], surfaces=[]
                )
            )
    return sorted(out, key=lambda i: (i.date, i.date_is_import_date))
