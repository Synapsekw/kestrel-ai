"""Block constructors (spec §8.1; plan R2). Every composer and every R9 figure hook builds blocks
here, so R0's discriminated `Block` union is the one shape and a misfit fails at compose time.
Field names follow R0's merged schemas (Task 2 Step 1): fix a rename here, nowhere else."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, TypedDict

from pydantic import TypeAdapter

from app.reports.schemas import Block, SnapshotRef

if TYPE_CHECKING:
    from app.reports.context import FindingRow

_BLOCK = TypeAdapter(Block)
Figure = Block  # a Block of kind "figure"
CONTENT_WIDTH_MM = 174.0  # A4 210 mm less two 18 mm margins (spec §10.1)
EMPTY = "No findings match the filters"
NONE = "-"  # a missing value (no em dash: index Global Constraints)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class Comment(TypedDict):
    author: str
    text: str
    created_at: str  # ISO 8601, UTC


def _block(kind: str, **fields: Any) -> Block:
    return _BLOCK.validate_python({"kind": kind, **fields})


def heading(text: str, level: int = 2) -> Block:
    return _block("heading", level=level, text=text)


def para(text: str, style: str = "body") -> Block:
    return _block("para", text=text, style=style)


def kv(rows: Sequence[tuple[str, str]]) -> Block:
    return _block("kv", rows=[[a, b] for a, b in rows])


def kpi(
    label: str, value: str, *, tone: str = "neutral", delta: str | None = None, colour: str | None = None
) -> dict:
    out = {"label": label, "value": value, "tone": tone, "delta": delta}
    if colour:
        out["colour"] = colour
    return out


def kpis(items: Sequence[dict]) -> Block:
    return _block("kpis", items=list(items))


def column(key: str, label: str, width_mm: float, align: str = "left") -> dict:
    return {"key": key, "label": label, "align": align, "width_mm": round(width_mm, 1)}


def table(columns: Sequence[dict], rows: Sequence[Sequence[str]], *, repeat_header: bool = True) -> Block:
    return _block("table", columns=list(columns), rows=[list(r) for r in rows], repeat_header=repeat_header)


def figure(ref: SnapshotRef, caption: str, width_mm: float, height_mm: float) -> Figure:
    return _block("figure", snapshot=ref, caption=caption, width_mm=width_mm, height_mm=height_mm)


def figure_row(figures: Sequence[Figure]) -> Block:
    return _block("figure_row", figures=list(figures))


def chart(kind: str, series: Sequence[dict], x_labels: Sequence[str], unit: str = "") -> Block:
    return _block("chart", chart=kind, series=list(series), x_labels=list(x_labels), unit=unit)


def page_break() -> Block:
    return _block("page_break")


def asset_map(drawing: dict, *, title: str, caption: str, width_mm: float, height_mm: float) -> Block:
    return _block(
        "asset_map", title=title, drawing=drawing, caption=caption, width_mm=width_mm, height_mm=height_mm
    )


def finding(row: FindingRow, *, figures, kv_rows, photos, comments, asset: dict | None = None) -> Block:
    head = {
        "type_name": row.type_name,
        "type_colour": row.type_colour,
        "status": row.status,
        "severity_name": row.severity_name,
        "severity_colour": row.severity_colour,
    }
    if row.severity is not None:
        head["severity_level"] = row.severity
    return _block(
        "finding",
        finding_id=row.id,
        number=row.number,
        head=head,
        figures=list(figures),
        kv=[[a, b] for a, b in kv_rows],
        note=row.note,
        photos=list(photos),
        comments=[dict(c) for c in comments],
        asset=asset,
    )


def cover(
    title: str,
    *,
    subtitle: str | None,
    rows: Sequence[tuple[str, str]],
    logo: dict | None,
    locator: Figure | None,
) -> Block:
    return _block(
        "cover", title=title, subtitle=subtitle, rows=[[a, b] for a, b in rows], logo=logo, locator=locator
    )


def fmt_date(d: date | datetime | None) -> str:
    if d is None:
        return NONE
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def fmt_lat_lon(lat: float | None, lon: float | None) -> str:
    if lat is None or lon is None:
        return NONE
    return f"{lat:.6f}, {lon:.6f}"
