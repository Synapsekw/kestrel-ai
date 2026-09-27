"""The browser's columnar index (image inspection spec I-D1, §7.1): one COUNT and one SELECT per
filter change, parallel arrays, capped at INDEX_CAP rows (`422 too_many_images` above it)."""

from __future__ import annotations

from sqlalchemy import func, select

from app.db.models import Image
from app.errors import AppError
from app.imagery import filters as image_filters
from app.imagery.filters import ImageFilters

INDEX_CAP = 100_000
FLAG_REVIEWED, FLAG_PENDING, FLAG_GPS, FLAG_EMPTY = 1, 2, 4, 8


def build_index(handle, f: ImageFilters, *, sort: str, order: str, geo: bool) -> dict:
    st = image_filters.stats(f)
    base = image_filters.where(image_filters.join_stats(select(Image.id), st), f, st)
    expr = image_filters.sort_expression(sort, st)
    ascending = order != "desc"
    q = base.with_only_columns(
        Image.id,
        func.coalesce(st.worst_severity, 0),
        st.finding_count,
        st.pending_count,
        st.reviewed,
        Image.marked_empty,
        Image.lon,
        Image.lat,
    ).order_by(expr.asc() if ascending else expr.desc(), Image.id.asc() if ascending else Image.id.desc())
    with handle.session() as s:
        total = s.execute(select(func.count()).select_from(base.subquery())).scalar_one()
        if total > INDEX_CAP:
            raise AppError(
                "too_many_images",
                f"{total} images match; narrow the filter (for example by flight) to {INDEX_CAP} or fewer",
                422,
                {"total": total, "cap": INDEX_CAP},
            )
        rows = s.execute(q).all()
    out: dict = {"total": len(rows), "ids": [], "sev": [], "count": [], "flags": []}
    lons, lats = [], []
    for image_id, sev, count, pending, reviewed, empty, lon, lat in rows:
        out["ids"].append(image_id)
        out["sev"].append(int(sev or 0))
        out["count"].append(int(count or 0))
        out["flags"].append(
            (FLAG_REVIEWED if reviewed else 0)
            | (FLAG_PENDING if pending else 0)
            | (FLAG_GPS if lon is not None and lat is not None else 0)
            | (FLAG_EMPTY if empty else 0)
        )
        lons.append(lon)
        lats.append(lat)
    if geo:
        out["lon"], out["lat"] = lons, lats
    return out
