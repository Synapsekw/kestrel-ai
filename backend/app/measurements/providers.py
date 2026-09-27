"""One provider per measurement kind: cloud, volume, map (spec 2026-09-26-map-workspace §4 item 8,
§12 `GET /measurements`; programme ruling R7).

Every provider pages its own table in the one union order - `created_at` descending (M-C0 Ruling 8:
an edit never moves a row), then `kind` ascending, then `id` ascending - over its
`ix_*_created` index, so the pages merge with a keyset cursor, as Foundation's
`data_items/providers.py` does. A page is one statement per provider, `limit` rows at most. Map and
volume headlines come from `json_extract`, so a page never loads a profile's arrays or a volume's
full results.

Image lengths are not a provider (deferred, I §20).
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import CloudMeasurement, MapMeasurement, VolumeMeasurement
from app.errors import AppError
from app.measurements.schemas import MeasurementItem
from app.pagination import decode_cursor, encode_cursor
from app.pointclouds.headline import headline_for

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class Headline(NamedTuple):
    value: float | None
    unit: str | None  # a MeasurementUnit value


NO_HEADLINE = Headline(None, None)


def _num(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return float(v) if math.isfinite(v) else None


def _headline(value, unit: str) -> Headline:
    v = _num(value)
    return Headline(v, unit) if v is not None else NO_HEADLINE


def _result(m: CloudMeasurement, key: str):
    return (m.results or {}).get(key)


def _point_z(m: CloudMeasurement):
    return (m.points or [{}])[0].get("z")


# The headline of a cloud measurement, per `cloud_measurement.kind` (the union's `sub_kind`).
# A sub-kind with no entry lists with NO_HEADLINE, never an error.
CLOUD_HEADLINES: dict[str, Callable[[CloudMeasurement], Headline]] = {
    "point": lambda m: _headline(_point_z(m), "m"),
    "distance": lambda m: _headline(_result(m, "distance_3d"), "m"),
    "height": lambda m: _headline(_result(m, "height_difference"), "m"),
    "vertical": lambda m: _headline(_result(m, "lean_mm_per_m"), "mm_per_m"),
    # C-B1: add "area" and "profile" entries here
    "area": lambda m: _headline(*headline_for("area", m.params, m.results, m.points)),
    "profile": lambda m: _headline(*headline_for("profile", m.params, m.results, m.points)),
}

# `cloud_measurement.status` (C-C0, C §12 row 7) -> the union status; missing or unknown is ready.
CLOUD_STATUS = {"ready": "ready", "computing": "computing", "failed": "failed"}
VOLUME_STATUS = {"calculating": "computing", "ready": "ready", "stale": "stale", "failed": "failed"}


def cloud_headline(m) -> Headline:
    fn = CLOUD_HEADLINES.get(m.kind)
    return fn(m) if fn else NO_HEADLINE


@dataclass(frozen=True)
class UnionKey:
    created_at: datetime
    kind: str
    id: str

    def order(self) -> tuple:
        """The Python mirror of the SQL order, used to merge provider pages."""
        micros = (self.created_at - EPOCH) // timedelta(microseconds=1)
        return (-micros, self.kind, self.id)

    @classmethod
    def of(cls, item: MeasurementItem) -> UnionKey:
        return cls(item.created_at, item.kind, item.id)


def encode_key(key: UnionKey) -> str:
    return encode_cursor(created_at=key.created_at.isoformat(), kind=key.kind, id=key.id)


def decode_key(cursor: str | None) -> UnionKey | None:
    c = decode_cursor(cursor, "created_at", "kind", "id")
    if not c:
        return None
    try:
        at = datetime.fromisoformat(str(c["created_at"]))
    except (TypeError, ValueError):
        raise AppError("validation_error", "invalid cursor", 422) from None
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return UnionKey(at, str(c["kind"]), str(c["id"]))


def _after(kind: str, created, id_col, key: UnionKey | None):
    """Rows of provider `kind` strictly after `key` in the union order (None: no condition)."""
    if key is None:
        return None
    if kind > key.kind:
        return created <= key.created_at
    if kind < key.kind:
        return created < key.created_at
    return or_(created < key.created_at, and_(created == key.created_at, id_col > key.id))


class Provider:
    kind: str
    sub_kinds: frozenset[str]

    def _skip(self, sub_kinds: list[str] | None) -> bool:
        return bool(sub_kinds) and not (self.sub_kinds & set(sub_kinds))

    def _query(self, q, model, after: UnionKey | None, limit: int, sub_col, sub_kinds):
        cond = _after(self.kind, model.created_at, model.id, after)
        if cond is not None:
            q = q.where(cond)
        if sub_kinds and sub_col is not None:
            q = q.where(sub_col.in_(sub_kinds))
        return q.order_by(model.created_at.desc(), model.id.asc()).limit(limit)

    def page(
        self, s: Session, after: UnionKey | None, limit: int, sub_kinds: list[str] | None
    ) -> list[MeasurementItem]:
        raise NotImplementedError


class CloudProvider(Provider):
    kind = "cloud"
    sub_kinds = frozenset({"point", "distance", "height", "vertical", "area", "profile"})

    def page(self, s, after, limit, sub_kinds):
        if self._skip(sub_kinds):
            return []
        q = self._query(
            select(CloudMeasurement), CloudMeasurement, after, limit, CloudMeasurement.kind, sub_kinds
        )
        items = []
        for m in s.execute(q).scalars():
            h = cloud_headline(m)
            items.append(
                MeasurementItem(
                    kind="cloud",
                    sub_kind=m.kind,
                    id=m.id,
                    name=m.name,
                    headline=h.value,
                    unit=h.unit,
                    data_type="point_cloud",
                    data_id=m.point_cloud_id,
                    status=CLOUD_STATUS.get(getattr(m, "status", None) or "ready", "ready"),
                    created_at=m.created_at,
                    updated_at=m.updated_at,
                )
            )
        return items


class VolumeProvider(Provider):
    kind = "volume"
    sub_kinds = frozenset({"volume"})

    def page(self, s, after, limit, sub_kinds):
        if self._skip(sub_kinds):
            return []
        v = VolumeMeasurement
        net = func.json_extract(v.results, "$.net_m3")
        cols = select(v.id, v.name, v.status, v.created_at, v.updated_at, v.top_surface_id, net)
        items = []
        for id_, name, status, created, updated, top, n in s.execute(
            self._query(cols, v, after, limit, None, None)
        ).all():
            h = _headline(n, "m3")
            items.append(
                MeasurementItem(
                    kind="volume",
                    sub_kind="volume",
                    id=id_,
                    name=name,
                    headline=h.value,
                    unit=h.unit,
                    data_type="elevation",
                    data_id=top,
                    status=VOLUME_STATUS.get(status, "failed"),
                    created_at=created,
                    updated_at=updated,
                )
            )
        return items


class MapProvider(Provider):
    kind = "map"
    sub_kinds = frozenset({"distance", "area", "profile"})

    def page(self, s, after, limit, sub_kinds):
        if self._skip(sub_kinds):
            return []
        m = MapMeasurement

        def extract(path: str):
            return func.json_extract(m.results, path)

        q = select(
            m.id,
            m.name,
            m.kind,
            m.created_at,
            m.updated_at,
            m.map_id,
            m.surface_ids,
            extract("$.length_m"),
            extract("$.grid_length_m"),
            extract("$.area_m2"),
            extract("$.grid_area_m2"),
        )
        rows = s.execute(self._query(q, m, after, limit, m.kind, sub_kinds)).all()
        items = []
        for (
            id_,
            name,
            kind,
            created,
            updated,
            map_id,
            surface_ids,
            length,
            grid_length,
            area,
            grid_area,
        ) in rows:
            if kind == "area":
                h = _headline(area if _num(area) is not None else grid_area, "m2")
            else:
                h = _headline(length if _num(length) is not None else grid_length, "m")
            if map_id:
                data_type, data_id = "map", map_id
            elif surface_ids:
                data_type, data_id = "elevation", surface_ids[0]
            else:
                data_type, data_id = None, None
            items.append(
                MeasurementItem(
                    kind="map",
                    sub_kind=kind,
                    id=id_,
                    name=name,
                    headline=h.value,
                    unit=h.unit,
                    data_type=data_type,
                    data_id=data_id,
                    status="ready",
                    created_at=created,
                    updated_at=updated,
                )
            )
        return items


PROVIDERS: dict[str, Provider] = {p.kind: p for p in (CloudProvider(), MapProvider(), VolumeProvider())}


def merge(pages: list[list[MeasurementItem]], limit: int) -> tuple[list[MeasurementItem], UnionKey | None]:
    """The first `limit` items of the merged pages, and the key to continue after (None at the end)."""
    items = sorted((i for page in pages for i in page), key=lambda i: UnionKey.of(i).order())
    if len(items) <= limit:
        return items, None
    items = items[:limit]
    return items, UnionKey.of(items[-1])
