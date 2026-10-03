# backend/app/asset_models/assemble.py
"""Plant spec -> GLB + register CSV + `asset_item` index (spec 2026-10-03-plant-model-generator §7,
plan 2026-10-03-plant-model-a1).

Node tree: root (site extras) -> area groups -> one node per item (extras = its register row) -> the
builder's child nodes; `environment` and the M1 top-level parts hang off the root. Scene frame (D9):
metres, x = plant N, y = EL - datum, z = plant E. Item nodes sit at the footprint reference point at
base EL; builders draw in that item-local frame.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from app.asset_models.builders.base import REGISTRY, BuildCtx, load_all
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref
from app.asset_models.spec import AssetSpec, Item, ItemFlag

CSV_COLUMNS = [
    "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N", "base_EL",
    "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes", "flags", "confidence",
]  # fmt: skip
UTM39_EPSG = 32639
UNASSIGNED_GROUP = "Area_unassigned"
_FORMULA_START = ("=", "+", "@")
_TEXT_COLUMNS = frozenset({"node", "tag", "name", "type", "area", "group", "source_sheet", "notes"})


def grid_of(spec: AssetSpec) -> PlantGrid | None:
    return PlantGrid(spec.site) if spec.site is not None else None


def site_label(spec: AssetSpec) -> str:
    return "utm39" if spec.site is not None and spec.site.crs.epsg == UTM39_EPSG else "site"


def group_name(area: str | None) -> str:
    if not area:
        return UNASSIGNED_GROUP
    return area if area.startswith("Area_") else f"Area_{area}"


def default_height(type_: str) -> float:
    found = REGISTRY.get(type_) or REGISTRY["other"]
    return float(found.default_height_m)


def item_ref(item: Item) -> tuple[float, float]:
    """The footprint reference point in plant (E, N); finite even for a degenerate footprint."""
    try:
        e, n = footprint_ref(item.footprint)
        if math.isfinite(e) and math.isfinite(n):
            return float(e), float(n)
    except Exception:
        pass
    fp = item.footprint
    pts = np.asarray(fp.pts if hasattr(fp, "pts") else [fp.center], dtype=float)
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


def _r(value, digits: int) -> float | None:
    if value is None:
        return None
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


def _flags(item: Item, extra: list[ItemFlag] | None) -> list[dict]:
    out = [f.model_dump(mode="json") for f in item.flags]
    seen = {f["code"] for f in out}
    for flag in extra or ():
        if flag.code not in seen:
            out.append(flag.model_dump(mode="json"))
            seen.add(flag.code)
    return out


def _sheet(item: Item, names: dict[str, str] | None) -> str | None:
    src = item.source
    if src.kind != "drawing" or not src.id:
        return None
    return (names or {}).get(src.id, src.id)


def register_rows(
    spec: AssetSpec,
    sheet_names: dict[str, str] | None = None,
    *,
    extra_flags: dict[str, list[ItemFlag]] | None = None,
    markers: set[str] | None = None,
    defaults: dict[str, list[str]] | None = None,
) -> list[dict]:
    """One register row per item, in spec order: CSV_COLUMNS (typed), then `lon`, `lat`."""
    if not spec.items:
        return []
    load_all()
    grid = grid_of(spec)
    ctx = BuildCtx(grid=grid)
    refs = np.array([item_ref(i) for i in spec.items], dtype=float)
    sx = sy = lon = lat = None
    if grid is not None:
        sx, sy = grid.plant_to_site(refs[:, 0], refs[:, 1])
        try:
            lon, lat = grid.site_to_lonlat(sx, sy)
        except GridError:
            lon = lat = None
    rows = []
    for k, item in enumerate(spec.items):
        base, top, defaulted = ctx.height(item, default_height(item.type))
        names = [n for n in (defaults or {}).get(item.id, ()) if n != "height"]
        notes = (
            "; ".join(
                x
                for x in (
                    item.notes,
                    f"Height assumed {top - base:g} m (type default)." if defaulted else None,
                    f"Defaults: {', '.join(names)}." if names else None,
                )
                if x
            )
            or None
        )
        rows.append(
            {
                "node": item.id,
                "tag": item.tag,
                "name": item.name,
                "type": item.type,
                "area": item.area,
                "group": group_name(item.area),
                "plant_E": _r(refs[k, 0], 2),
                "plant_N": _r(refs[k, 1], 2),
                "utm39_E": _r(sx[k], 2) if sx is not None else None,
                "utm39_N": _r(sy[k], 2) if sy is not None else None,
                "base_EL": _r(base, 3),
                "height_m": _r(top - base, 3),
                "top_EL": _r(top, 3),
                "height_source": "indicative" if defaulted else item.height_source,
                "has_geometry": item.id not in (markers or ()),
                "source_sheet": _sheet(item, sheet_names),
                "notes": notes,
                "flags": _flags(item, (extra_flags or {}).get(item.id)),
                "confidence": item.confidence,
                "lon": _r(lon[k], 8) if lon is not None else None,
                "lat": _r(lat[k], 8) if lat is not None else None,
            }
        )
    return rows


def _cell(column: str, value) -> str:
    if value is None:
        return ""
    if column == "has_geometry":
        return "yes" if value else "no"
    if column == "flags":
        return ";".join(f["code"] for f in value)
    if isinstance(value, float):
        return repr(value)
    text = str(value)
    if column in _TEXT_COLUMNS and text.startswith(_FORMULA_START):
        return "'" + text  # never hand Excel a formula read off a drawing
    return text


def write_csv(rows: list[dict], path: Path, *, site_label: str = "utm39") -> None:
    """Cowork's column order; UTF-8 without BOM and CRLF line ends, like Cowork's register."""
    header = [f"{site_label}_{c[6:]}" if c.startswith("utm39_") else c for c in CSV_COLUMNS]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in rows:
            writer.writerow([_cell(c, row.get(c)) for c in CSV_COLUMNS])
