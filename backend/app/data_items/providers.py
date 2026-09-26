"""One provider per data item type (spec 2026-09-26-foundation section 6.3).

Every provider pages its own table in the one Data list order - `captured_on` descending with
undated rows last, then `created_at` descending, then `id` ascending - so their pages merge with a
keyset cursor. A page is one statement per provider, `limit` rows at most. `drawing` has no
provider until unit M adds its table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.data_items.schemas import DataItem
from app.db.models import GeoMap, Job, PointCloud, Source, Surface
from app.errors import AppError
from app.pagination import decode_cursor, encode_cursor

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
LIVE_JOB_STATES = ("queued", "running")


@dataclass(frozen=True)
class SortKey:
    captured_on: date | None
    created_at: datetime
    id: str

    def order(self) -> tuple:
        """The Python mirror of the SQL order, used to merge provider pages."""
        undated = self.captured_on is None
        day = 0 if undated else -self.captured_on.toordinal()
        micros = (self.created_at - EPOCH) // timedelta(microseconds=1)
        return (undated, day, -micros, self.id)

    @classmethod
    def of(cls, item: DataItem) -> SortKey:
        return cls(item.captured_on, item.created_at, item.id)


def encode_key(key: SortKey) -> str:
    return encode_cursor(
        captured_on=key.captured_on.isoformat() if key.captured_on else None,
        created_at=key.created_at.isoformat(),
        id=key.id,
    )


def decode_key(cursor: str | None) -> SortKey | None:
    c = decode_cursor(cursor, "captured_on", "created_at", "id")
    if not c:
        return None
    try:
        day = date.fromisoformat(c["captured_on"]) if c["captured_on"] is not None else None
        created = datetime.fromisoformat(str(c["created_at"]))
    except (TypeError, ValueError):
        raise AppError("validation_error", "invalid cursor", 422) from None
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return SortKey(day, created, str(c["id"]))


def _after(captured, created, id_col, key: SortKey):
    """Rows strictly after `key` in the Data list order."""
    tail = or_(created < key.created_at, and_(created == key.created_at, id_col > key.id))
    if key.captured_on is None:
        return and_(captured.is_(None), tail)
    return or_(captured.is_(None), captured < key.captured_on, and_(captured == key.captured_on, tail))


class _Provider:
    """Shared paging and search; a subclass names its columns, its select and its item."""

    type: str

    def columns(self):
        """(captured_on, created_at, id, label) column expressions."""
        raise NotImplementedError

    def base(self):
        raise NotImplementedError

    def count_query(self):
        raise NotImplementedError

    def item(self, row) -> DataItem:
        raise NotImplementedError

    def _run(self, s: Session, q, limit: int) -> list[DataItem]:
        captured, created, id_col, _ = self.columns()
        q = q.order_by(captured.is_(None), captured.desc(), created.desc(), id_col.asc()).limit(limit)
        return [self.item(row) for row in s.execute(q).all()]

    def page(self, s: Session, after: SortKey | None, limit: int) -> list[DataItem]:
        captured, created, id_col, _ = self.columns()
        q = self.base()
        if after is not None:
            q = q.where(_after(captured, created, id_col, after))
        return self._run(s, q, limit)

    def search(self, s: Session, pattern: str, limit: int) -> list[DataItem]:
        label = self.columns()[3]
        return self._run(s, self.base().where(label.ilike(pattern, escape="\\")), limit)

    def count(self, s: Session) -> int:
        return s.execute(self.count_query()).scalar_one()


def image_set_status(job_state: str | None, imported_at: datetime | None) -> str:
    if job_state in LIVE_JOB_STATES:
        return "importing"
    return "ready" if imported_at is not None else "failed"


class ImageSets(_Provider):
    type = "image_set"
    _is_images = func.coalesce(Source.kind, "images") == "images"

    def columns(self):
        label = func.coalesce(func.nullif(Source.label, ""), Source.site)
        return Source.captured_on, Source.created_at, Source.id, label

    def base(self):
        return select(Source, Job.state).outerjoin(Job, Job.id == Source.job_id).where(self._is_images)

    def count_query(self):
        return select(func.count()).select_from(Source).where(self._is_images)

    def item(self, row) -> DataItem:
        src, job_state = row
        return DataItem(
            id=src.id,
            type="image_set",
            label=src.label or src.site,
            captured_on=src.captured_on,
            status=image_set_status(job_state, src.imported_at),
            created_at=src.created_at,
            summary={"image_count": src.image_count, "duplicate_count": src.duplicate_count},
        )


class Maps(_Provider):
    type = "map"

    def columns(self):
        return GeoMap.captured_on, GeoMap.created_at, GeoMap.id, GeoMap.name

    def base(self):
        return select(GeoMap)

    def count_query(self):
        return select(func.count()).select_from(GeoMap)

    def item(self, row) -> DataItem:
        (m,) = row
        return DataItem(
            id=m.id,
            type="map",
            label=m.name,
            captured_on=m.captured_on,
            status=m.status,
            created_at=m.created_at,
            summary={"gsd_cm": m.gsd_cm, "epsg": m.epsg, "width": m.width, "height": m.height},
        )


class Elevations(_Provider):
    """Surfaces: a cloud DSM is dated by its cloud, a design surface is never dated."""

    type = "elevation"
    _day = case((Surface.kind == "cloud_dsm", PointCloud.captured_on), else_=None)

    def columns(self):
        return self._day, Surface.created_at, Surface.id, Surface.name

    def base(self):
        return select(Surface, self._day.label("day")).outerjoin(
            PointCloud, PointCloud.id == Surface.point_cloud_id
        )

    def count_query(self):
        return select(func.count()).select_from(Surface)

    def item(self, row) -> DataItem:
        surface, day = row
        return DataItem(
            id=surface.id,
            type="elevation",
            label=surface.name,
            captured_on=day,
            status="importing" if surface.status == "building" else surface.status,
            created_at=surface.created_at,
            summary={
                "kind": surface.kind,
                "cell_size_m": surface.cell_size_m,
                "z_min": surface.z_min,
                "z_max": surface.z_max,
            },
        )


class PointClouds(_Provider):
    type = "point_cloud"

    def columns(self):
        return PointCloud.captured_on, PointCloud.created_at, PointCloud.id, PointCloud.name

    def base(self):
        return select(PointCloud)

    def count_query(self):
        return select(func.count()).select_from(PointCloud)

    def item(self, row) -> DataItem:
        (c,) = row
        return DataItem(
            id=c.id,
            type="point_cloud",
            label=c.name,
            captured_on=c.captured_on,
            status=c.status,
            created_at=c.created_at,
            summary={"point_count": c.point_count, "has_rgb": c.has_rgb, "epsg": c.epsg},
        )


PROVIDERS: dict[str, _Provider] = {p.type: p for p in (ImageSets(), Maps(), Elevations(), PointClouds())}


def merge(pages: list[list[DataItem]], limit: int) -> tuple[list[DataItem], SortKey | None]:
    """The first `limit` items of the merged pages, and the key to continue after (None at the end)."""
    items = sorted((i for page in pages for i in page), key=lambda i: SortKey.of(i).order())
    if len(items) <= limit:
        return items, None
    items = items[:limit]
    return items, SortKey.of(items[-1])
