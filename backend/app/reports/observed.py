"""The observed date and host data item of a finding (spec 2026-09-26-reports §7.1, plan R2).

The observed date is the day the site looked like this: an image anchor's EXIF capture time, else
the host data item's `captured_on`, else the finding's `created_at`, as a UTC calendar day. The SQL
forms are correlated expressions over `finding` (filters, sorts and aggregates use them without
loading rows). The Python forms apply the same rule to one ORM finding, for R5's CSV/XLSX writers.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import String, case, func, select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, Finding, GeoMap, Image, PointCloud, Source

log = logging.getLogger(__name__)


def _by_data_id(expr, id_col):
    return select(expr).where(id_col == Finding.data_id).correlate(Finding).scalar_subquery()


def observed_on():
    """'YYYY-MM-DD' text; never null (created_at is never null)."""
    exif = (
        select(func.date(Image.capture_time))
        .where(Image.id == Finding.image_id)
        .correlate(Finding)
        .scalar_subquery()
    )
    item_day = case(
        (Finding.data_type == "image_set", _by_data_id(func.date(Source.captured_on), Source.id)),
        (Finding.data_type == "map", _by_data_id(func.date(GeoMap.captured_on), GeoMap.id)),
        (Finding.data_type == "point_cloud", _by_data_id(func.date(PointCloud.captured_on), PointCloud.id)),
        (Finding.data_type == "asset_model", _by_data_id(func.date(AssetModel.captured_on), AssetModel.id)),
        else_=None,
    )
    image_day = case((Finding.anchor_kind == "image", exif), else_=None)
    return func.coalesce(image_day, item_day, func.date(Finding.created_at), type_=String)


def data_label():
    """The host data item's label ('' when it is gone)."""
    src = _by_data_id(func.coalesce(func.nullif(Source.label, ""), Source.site), Source.id)
    return func.coalesce(
        case(
            (Finding.data_type == "image_set", src),
            (Finding.data_type == "map", _by_data_id(GeoMap.name, GeoMap.id)),
            (Finding.data_type == "point_cloud", _by_data_id(PointCloud.name, PointCloud.id)),
            (Finding.data_type == "asset_model", _by_data_id(AssetModel.name, AssetModel.id)),
            else_=None,
        ),
        "",
        type_=String,
    )


def _host(s: Session, f: Finding):
    model = {"image_set": Source, "map": GeoMap, "point_cloud": PointCloud, "asset_model": AssetModel}.get(
        f.data_type
    )
    return s.get(model, f.data_id) if model is not None else None


def observed_day(s: Session, f: Finding) -> date:
    if f.anchor_kind == "image" and f.image_id:
        image = s.get(Image, f.image_id)
        if image is not None and image.capture_time is not None:
            return image.capture_time.date()  # UTCDateTime returns aware UTC
    host = _host(s, f)
    day = getattr(host, "captured_on", None)
    return day if day is not None else f.created_at.date()


def host_label(s: Session, f: Finding) -> str:
    host = _host(s, f)
    if host is None:
        return ""
    if isinstance(host, Source):
        return host.label or host.site
    return host.name


def area_m2(s: Session, f: Finding) -> float | None:
    """A map polygon's area when its map's CRS is projected in metres; otherwise None (Ruling 16)."""
    if f.anchor_kind != "map" or not f.geometry or f.geometry.get("type") != "Polygon":
        return None
    gmap = s.get(GeoMap, f.map_id)
    if gmap is None or not gmap.crs_wkt:
        return None
    try:
        from pyproj import CRS

        crs = CRS.from_wkt(gmap.crs_wkt)
        if not crs.is_projected or crs.axis_info[0].unit_name not in ("metre", "meter"):
            return None
    except Exception:
        log.warning("could not read the CRS of map %s", gmap.id, exc_info=True)
        return None
    ring = f.geometry["coordinates"][0]
    twice = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:], strict=False))
    return abs(twice) / 2.0
