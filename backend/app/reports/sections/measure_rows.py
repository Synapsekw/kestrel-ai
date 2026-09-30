"""The measurements section's rows over M's union (`app.measurements.union.list_page`, reports spec
§7.2; plan R9-M Ruling 8). Bounded: one union page (PAGE rows) at a time, one name lookup per data
type per page; rows are plain strings."""

from __future__ import annotations

from collections.abc import Iterable, Iterator

from sqlalchemy import select

from app.db.models import GeoMap, PointCloud, Surface
from app.measurements.schemas import MeasurementItem
from app.measurements.union import list_page
from app.reports import blocks
from app.reports.schemas import Block

PAGE = 200
STALE = "stale, recalculate"
GROUPS: dict[str, tuple[tuple[str, str], ...]] = {
    "length": (("map", "distance"), ("cloud", "distance")),
    "area": (("map", "area"), ("cloud", "area")),
    "height": (("cloud", "height"),),
    "lean": (("cloud", "vertical"),),
    "profile": (("map", "profile"), ("cloud", "profile")),
    "volume": (("volume", "volume"),),
}
ORDER = ("length", "area", "height", "lean", "profile", "volume")
TITLES = {
    "length": "Lengths",
    "area": "Areas",
    "height": "Heights",
    "lean": "Lean (verticality)",
    "profile": "Profiles",
    "volume": "Volumes",
}
SOURCE_TEXT = {
    ("map", "distance"): "Map distance",
    ("cloud", "distance"): "Cloud distance",
    ("map", "area"): "Map area",
    ("cloud", "area"): "Cloud area",
    ("cloud", "height"): "Cloud height",
    ("cloud", "vertical"): "Cloud lean",
    ("map", "profile"): "Map profile",
    ("cloud", "profile"): "Cloud profile",
    ("volume", "volume"): "Volume",
}
STATUS_TEXT = {"stale": STALE, "computing": "calculating", "failed": "failed"}
UNIT_TEXT = {"m": "m", "m2": "m²", "m3": "m³"}
NAME_MODELS = {"map": GeoMap, "point_cloud": PointCloud, "elevation": Surface}
COLUMNS = (
    ("name", "Name", "left", 50),
    ("on", "On", "left", 40),
    ("source", "Source", "left", 26),
    ("value", "Value", "right", 26),
    ("status", "Status", "left", 16),
    ("created", "Created", "left", 16),
)


def iter_group_pages(handle, group: str, ids: set[str] | None) -> Iterator[list[MeasurementItem]]:
    """The union's rows of one report kind, newest first, a page at a time (empty pages skipped)."""
    pairs = GROUPS[group]
    kinds = sorted({k for k, _ in pairs})
    subs = sorted({s for _, s in pairs})
    cursor = None
    while True:
        page = list_page(handle, kinds=kinds, sub_kinds=subs, limit=PAGE, cursor=cursor)
        items = [i for i in page.items if (i.kind, i.sub_kind) in pairs and (ids is None or i.id in ids)]
        if items:
            yield items
        if page.next_cursor is None:
            return
        cursor = page.next_cursor


def data_labels(handle, items: Iterable[MeasurementItem]) -> dict[str, str]:
    wanted: dict[str, set[str]] = {}
    for i in items:
        if i.data_type in NAME_MODELS and i.data_id:
            wanted.setdefault(i.data_type, set()).add(i.data_id)
    out: dict[str, str] = {}
    with handle.session() as s:
        for data_type, ids in wanted.items():
            model = NAME_MODELS[data_type]
            out.update(dict(s.execute(select(model.id, model.name).where(model.id.in_(ids))).all()))
    return out


def value_text(item: MeasurementItem, stale: bool | None = None) -> str:
    if stale:
        return STALE
    if item.status in STATUS_TEXT:
        return STATUS_TEXT[item.status]
    v, unit = item.headline, item.unit
    if v is None:
        return "—"
    if unit == "deg":
        return f"{v:.1f}°"
    if unit == "mm_per_m":
        return f"{v:.1f} mm/m"
    return f"{v:,.2f} {UNIT_TEXT[unit]}" if unit in UNIT_TEXT else f"{v:,.2f}"


def table_row(item: MeasurementItem, labels: dict[str, str], stale: bool | None = None) -> list[str]:
    status = STALE if stale else item.status
    return [
        item.name,
        labels.get(item.data_id or "", "—"),
        SOURCE_TEXT[(item.kind, item.sub_kind)],
        value_text(item, stale),
        status,
        item.created_at.strftime("%d %b %Y"),
    ]


def table(rows: list[list[str]]) -> Block:
    """The rows as an `app.reports.blocks.table` block; the numeric Value column is styled "mono"
    (controller Ruling P5)."""
    columns = [
        {**blocks.column(key, label, width_mm, align=align), "style": "mono"}
        if key == "value"
        else blocks.column(key, label, width_mm, align=align)
        for key, label, align, width_mm in COLUMNS
    ]
    return blocks.table(columns, rows)
