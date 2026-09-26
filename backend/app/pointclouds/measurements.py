"""Measurement rows (spec §3 `cloud_measurement`, §9): the server computes and stores the results."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from pyproj import CRS, Transformer
from sqlalchemy import func, select

from app.db.models import CloudMeasurement
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


def create(handle: ProjectHandle, cloud_id: str, body: CloudMeasurementCreate) -> CloudMeasurement:
    cloud = rows.require_ready(handle, cloud_id)
    points = [p.model_dump() for p in body.points]
    expected = 1 if body.kind == "point" else 2
    if len(points) != expected:
        raise AppError(
            "wrong_point_count",
            f"a {LABELS[body.kind].lower()} needs {expected} point{'s' if expected > 1 else ''}",
            422,
        )
    if body.kind != "point" and cloud.crs_wkt and CRS.from_wkt(cloud.crs_wkt).is_geographic:
        raise AppError(
            "needs_projected_crs",
            "distances need a projected coordinate system; this cloud is in degrees",
            422,
        )
    points = measure.ordered(body.kind, points)
    if body.kind == "vertical" and abs(points[1]["z"] - points[0]["z"]) < measure.MIN_VERTICAL_SPAN_M:
        raise AppError(
            "vertical_span_too_small", "pick points further apart vertically (at least 0.5 m)", 422
        )
    results = measure.results(body.kind, points)
    if body.kind == "point" and cloud.crs_wkt:
        results["lon"], results["lat"] = lonlat(cloud.crs_wkt, points[0]["x"], points[0]["y"])
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
        row = CloudMeasurement(
            point_cloud_id=cloud_id,
            kind=body.kind,
            name=body.name or _next_name(s, cloud_id, body.kind),
            note=body.note,
            points=points,
            results=results,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


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
        row.updated_at = datetime.now(UTC)
        s.flush()
        s.expunge(row)
    return row


def delete(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> None:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        s.delete(_get(s, cloud_id, measurement_id))
