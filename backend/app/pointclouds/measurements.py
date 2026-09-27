"""Measurement rows (S1 spec §3 `cloud_measurement`, §9; workspace spec 2026-09-26 §8): the server
computes and stores the results, and refuses geometry it cannot measure with a 422 that names the fix.

`insert` adds a row under the 1 000 cap with a "Label n" name; profiles are inserted by C-B2's
`profile.create_profile_measurement`."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from pyproj import CRS, Transformer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import CloudMeasurement, Finding, PointCloud
from app.errors import AppError, not_found
from app.pointclouds import measure, rows
from app.pointclouds.schemas import CloudMeasurementCreate, CloudMeasurementUpdate
from app.projects.service import ProjectHandle

MAX_PER_CLOUD = 1000
LABELS = {
    "point": "Point",
    "distance": "Distance",
    "height": "Height difference",
    "vertical": "Vertical check",
    "area": "Area",
    "profile": "Cross-section",
}


def lonlat(crs_wkt: str, x: float, y: float) -> tuple[float, float]:
    lon, lat = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True).transform(
        x, y
    )
    return float(lon), float(lat)


def list_for(handle: ProjectHandle, cloud_id: str) -> list[CloudMeasurement]:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        items = list(
            s.execute(
                select(CloudMeasurement)
                .where(CloudMeasurement.point_cloud_id == cloud_id)
                .order_by(CloudMeasurement.created_at, CloudMeasurement.id)
            ).scalars()
        )
        for m in items:
            s.expunge(m)
    return items


def _next_name(s, cloud_id: str, kind: str) -> str:
    label = LABELS[kind]
    pattern = re.compile(rf"^{re.escape(label)} (\d+)$")
    names = s.execute(
        select(CloudMeasurement.name).where(
            CloudMeasurement.point_cloud_id == cloud_id, CloudMeasurement.kind == kind
        )
    ).scalars()
    numbers = [int(m.group(1)) for n in names if (m := pattern.match(n))]
    return f"{label} {max(numbers, default=0) + 1}"


def check_crs(cloud: PointCloud, kind: str) -> None:
    """Everything but a single point needs metres: a cloud in degrees is refused (S1 rule)."""
    if kind != "point" and cloud.crs_wkt and CRS.from_wkt(cloud.crs_wkt).is_geographic:
        raise AppError(
            "needs_projected_crs",
            "distances need a projected coordinate system; this cloud is in degrees",
            422,
        )


def _plain(points: list[dict]) -> list[dict]:
    """`group` only means something in a rings vertical check; every other kind stores points without it."""
    return [{k: v for k, v in p.items() if k != "group"} for p in points]


def measure_points(kind: str, points: list[dict], params: dict | None) -> tuple[list[dict], dict]:
    """The points as stored and the server's results, or the 422 that refuses them (spec §8.2)."""
    try:
        if kind == "area":
            return _plain(measure.area_vertices(points)), measure.area_results(points, params)
        if kind == "vertical" and measure.method_of(params) == "rings":
            return points, measure.rings_results(points)
    except measure.Refusal as e:
        raise AppError(e.code, e.message, 422) from None
    except ArithmeticError:  # OverflowError, ZeroDivisionError the guards missed: a 422, never a 500
        code = "degenerate_polygon" if kind == "area" else "collinear_ring"
        raise AppError(code, measure.TOO_LARGE, 422) from None
    points = _plain(points)
    expected = 1 if kind == "point" else 2
    if len(points) != expected:
        raise AppError(
            "wrong_point_count",
            f"a {LABELS[kind].lower()} needs {expected} point{'s' if expected > 1 else ''}",
            422,
        )
    points = measure.ordered(kind, points)
    if kind == "vertical" and abs(points[1]["z"] - points[0]["z"]) < measure.MIN_VERTICAL_SPAN_M:
        raise AppError(
            "vertical_span_too_small", "pick points further apart vertically (at least 0.5 m)", 422
        )
    return points, measure.results(kind, points)


def _params(body: CloudMeasurementCreate) -> dict | None:
    """Stored as sent, minus null keys; an empty object is stored as null."""
    if body.params is None:
        return None
    return body.params.model_dump(exclude_none=True) or None


def check_finding(s: Session, cloud_id: str, finding_id: str | None) -> None:
    """A measurement attaches only to a finding pinned on the same cloud (spec §8.5 "Attach to finding")."""
    if finding_id is None:
        return
    finding = s.get(Finding, finding_id)
    if finding is None or finding.anchor_kind != "cloud" or finding.cloud_id != cloud_id:
        raise AppError(
            "invalid_finding", "attach the measurement to a finding pinned on this point cloud", 422
        )


def require_finding(handle: ProjectHandle, cloud_id: str, finding_id: str | None) -> None:
    """The create route's first check, for every kind (the profile included): 404 for an unknown
    cloud, then 422 `invalid_finding`. `insert` checks again inside its transaction."""
    if finding_id is None:
        return
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        check_finding(s, cloud_id, finding_id)


def insert(
    handle: ProjectHandle,
    cloud_id: str,
    *,
    kind: str,
    points: list[dict],
    results: dict,
    params: dict | None = None,
    name: str | None = None,
    note: str | None = None,
    status: str = "ready",
    job_id: str | None = None,
    finding_id: str | None = None,
) -> CloudMeasurement:
    """One new row under the 1 000 cap, named "<Label> n" when unnamed, in one transaction."""
    with handle.session() as s:
        count = s.execute(
            select(func.count())
            .select_from(CloudMeasurement)
            .where(CloudMeasurement.point_cloud_id == cloud_id)
        ).scalar_one()
        if count >= MAX_PER_CLOUD:
            raise AppError(
                "measurement_limit", "this cloud already has 1 000 measurements; delete some first", 422
            )
        check_finding(s, cloud_id, finding_id)
        row = CloudMeasurement(
            point_cloud_id=cloud_id,
            kind=kind,
            name=name or _next_name(s, cloud_id, kind),
            note=note,
            points=points,
            results=results,
            params=params,
            status=status,
            job_id=job_id,
            finding_id=finding_id,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def create(handle: ProjectHandle, cloud_id: str, body: CloudMeasurementCreate) -> CloudMeasurement:
    cloud = rows.require_ready(handle, cloud_id)
    check_crs(cloud, body.kind)
    params = _params(body)
    points, results = measure_points(
        body.kind, [p.model_dump(exclude_none=True) for p in body.points], params
    )
    if body.kind == "point" and cloud.crs_wkt:
        results["lon"], results["lat"] = lonlat(cloud.crs_wkt, points[0]["x"], points[0]["y"])
    return insert(
        handle,
        cloud_id,
        kind=body.kind,
        points=points,
        results=results,
        params=params,
        name=body.name,
        note=body.note,
        finding_id=body.finding_id,
    )


def _get(s, cloud_id: str, measurement_id: str) -> CloudMeasurement:
    row = s.get(CloudMeasurement, measurement_id)
    if row is None or row.point_cloud_id != cloud_id:
        raise not_found("measurement", measurement_id)
    return row


def update(
    handle: ProjectHandle, cloud_id: str, measurement_id: str, body: CloudMeasurementUpdate
) -> CloudMeasurement:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        row = _get(s, cloud_id, measurement_id)
        if "name" in body.model_fields_set and body.name is not None:
            row.name = body.name
        if "note" in body.model_fields_set:
            row.note = body.note
        if "finding_id" in body.model_fields_set:
            check_finding(s, cloud_id, body.finding_id)
            row.finding_id = body.finding_id
        row.updated_at = datetime.now(UTC)
        s.flush()
        s.expunge(row)
    return row


def delete(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> None:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        s.delete(_get(s, cloud_id, measurement_id))
