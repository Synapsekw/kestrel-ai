"""Rows for the R9-C tests (reports 3D views): a cloud with findings and measurements, stored views
through C's own `views.store`, a stale view, and cloud-derived surfaces with chosen bounds."""

from __future__ import annotations

from datetime import UTC, datetime

from cloud_views import meta_json, png
from pointclouds import insert_cloud
from sqlalchemy import update

from app.db.models import CloudMeasurement, CloudView, Finding, Surface
from app.findings import service
from app.findings.anchors import AnchorIn
from app.measurements.schemas import MeasurementItem
from app.pointclouds import views

X, Y, Z = 243540.2, 3178030.5, 12.4  # inside insert_cloud's bounds_native
GENERATED_AT = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
T0 = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)

__all__ = ["insert_cloud", "png"]


def cloud_finding(handle, type_id: str, cloud_id: str, *, x=X, y=Y, z=Z) -> Finding:
    anchor = AnchorIn(kind="cloud", cloud_id=cloud_id, x=x, y=y, z=z)
    return service.create_finding(handle, type_id=type_id, anchor=anchor)


def cloud_measurement(handle, cloud_id: str, *, kind: str = "distance", points=None, name="M1") -> str:
    """A cloud_measurement row inserted directly (results are not what R9-C reads)."""
    points = points or [
        {"x": X - 5.0, "y": Y, "z": Z, "uncertainty_m": 0.01},
        {"x": X + 5.0, "y": Y, "z": Z, "uncertainty_m": 0.01},
    ]
    with handle.session() as s:
        m = CloudMeasurement(point_cloud_id=cloud_id, kind=kind, name=name, points=points, results={})
        s.add(m)
        s.flush()
        return m.id


def store_finding_view(handle, finding_id: str, data: bytes | None = None):
    meta = views.parse_meta(meta_json(), "finding")
    return views.store(handle, views.finding_subject(handle, finding_id), data or png(), meta)


def store_measurement_view(handle, cloud_id: str, measurement_id: str, data: bytes | None = None):
    meta = views.parse_meta(meta_json(), "cloud_measurement")
    subject = views.measurement_subject(handle, cloud_id, measurement_id)
    return views.store(handle, subject, data or png(), meta)


def make_stale(handle, *, finding_id: str | None = None, measurement_id: str | None = None) -> None:
    """The anchor 'moved since capture': C computes stale = anchor_hash != hash(current geometry)."""
    col = CloudView.finding_id if finding_id else CloudView.cloud_measurement_id
    with handle.session() as s:
        s.execute(update(CloudView).where(col == (finding_id or measurement_id)).values(anchor_hash="moved"))


def insert_surface(
    handle,
    cloud_id: str | None,
    *,
    bounds=(X - 50.0, Y - 50.0, X + 50.0, Y + 50.0),
    kind: str = "cloud_dsm",
    status: str = "ready",
    name: str = "DSM 14 Sep",
    created_at: datetime = T0,
) -> str:
    with handle.session() as s:
        row = Surface(
            name=name,
            kind=kind,
            status=status,
            point_cloud_id=cloud_id,
            bounds_native=list(bounds),
            cell_size_m=0.5,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def make_ctx(handle):
    """A ComposeContext with the finding_pages section enabled (its default options include
    snapshots ["image", "map", "cloud"]); built over R2's `reports_rows.config`/`ctx_for` merged
    helpers (the plan's BUILTIN_TEMPLATES construction predates the merge)."""
    from reports_rows import config, ctx_for

    return ctx_for(handle, config(sections=("finding_pages",)), report_id="r-test")


def row_of(handle, finding_id: str):
    """The FindingRow R2's iterator yields for `finding_id` (the hook's `finding` argument)."""
    from app.reports.context import FindingRow

    with handle.session() as s:
        return FindingRow.from_finding(s.get(Finding, finding_id))


def measurement_row(handle, cloud_id: str, measurement_id: str, name: str = "M1") -> MeasurementItem:
    """The union row R9-M passes (only kind, id, name and data_id matter here)."""
    return MeasurementItem(
        kind="cloud",
        sub_kind="distance",
        id=measurement_id,
        name=name,
        headline=10.0,
        unit="m",
        data_type="point_cloud",
        data_id=cloud_id,
        status="ready",
        created_at=T0,
        updated_at=T0,
    )
