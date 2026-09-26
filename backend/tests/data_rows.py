"""Rows for the Data list and search tests (plan BK): one builder per data item type, inserted
directly. No file on disk is needed; the Data list reads rows only."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.db.models import GeoMap, Job, PointCloud, Source, Surface

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)


def at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


def add_image_set(
    handle,
    *,
    site: str,
    label: str | None = None,
    captured_on: date | None = None,
    created_at: datetime = T0,
    job_state: str | None = "succeeded",
    imported: bool = True,
    kind: str = "images",
    image_count: int = 12,
    duplicate_count: int = 1,
) -> str:
    with handle.session() as s:
        job_id = None
        if job_state is not None:
            job = Job(type="import", state=job_state)
            s.add(job)
            s.flush()
            job_id = job.id
        row = Source(
            folder=f"D:/photos/{site}",
            site=site,
            label=label,
            kind=kind,
            captured_on=captured_on,
            created_at=created_at,
            job_id=job_id,
            imported_at=T0 if imported else None,
            image_count=image_count,
            duplicate_count=duplicate_count,
        )
        s.add(row)
        s.flush()
        return row.id


def add_map(
    handle,
    *,
    name: str = "ortho",
    captured_on: date | None = None,
    created_at: datetime = T0,
    status: str = "ready",
) -> str:
    with handle.session() as s:
        row = GeoMap(
            name=name,
            status=status,
            source_path="D:/orthos/site.tif",
            source_size=1,
            width=100,
            height=80,
            gsd_cm=2.5,
            epsg=32633,
            captured_on=captured_on,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_cloud(
    handle,
    *,
    name: str = "cloud",
    captured_on: date | None = None,
    created_at: datetime = T0,
    status: str = "ready",
) -> str:
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status=status,
            source_path="D:/clouds/site.laz",
            source_size=1,
            point_count=1000,
            has_rgb=True,
            epsg=32633,
            captured_on=captured_on,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id


def add_surface(
    handle,
    *,
    name: str = "dsm",
    kind: str = "design",
    cloud_id: str | None = None,
    created_at: datetime = T0,
    status: str = "ready",
) -> str:
    with handle.session() as s:
        row = Surface(
            name=name,
            kind=kind,
            status=status,
            point_cloud_id=cloud_id,
            cell_size_m=0.1,
            z_min=1.0,
            z_max=5.0,
            created_at=created_at,
        )
        s.add(row)
        s.flush()
        return row.id
