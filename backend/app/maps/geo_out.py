"""CSV, GeoJSON and summary writers for map boxes (spec section 9).

Every box converts through its four real corners, so a rotated box (OBB wave 2) needs no
special case. CSV carries both the map's CRS and WGS84; GeoJSON is WGS84 only, as RFC 7946 says.
"""

from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path

from app.maps.georef import Georef, box_corners

CSV_COLUMNS = [
    "kind",
    "id",
    "class",
    "confidence",
    "match",
    "source",
    "px_x",
    "px_y",
    "px_w",
    "px_h",
    "epsg",
    "x1",
    "y1",
    "x2",
    "y2",
    "x3",
    "y3",
    "x4",
    "y4",
    "cx",
    "cy",
    "lon1",
    "lat1",
    "lon2",
    "lat2",
    "lon3",
    "lat3",
    "lon4",
    "lat4",
    "clon",
    "clat",
    "width_m",
    "height_m",
    "area_m2",
]


@dataclass(frozen=True)
class ExportBox:
    kind: str  # detection | label
    id: str
    class_name: str
    confidence: float | None
    match: str  # tp | fp | fn | "" when unscored or outside every zone
    source: str
    x: float
    y: float
    w: float
    h: float
    angle: float | None


def _native(georef: Georef, box: ExportBox) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    corners = [
        georef.pixel_to_native(px, py) for px, py in box_corners(box.x, box.y, box.w, box.h, box.angle)
    ]
    centre = georef.pixel_to_native(box.x + box.w / 2, box.y + box.h / 2)
    return corners, centre


def write_csv(path: Path, boxes: list[ExportBox], georef: Georef | None, epsg: int | None) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for b in boxes:
            row = {k: "" for k in CSV_COLUMNS}
            row.update(
                {
                    "kind": b.kind,
                    "id": b.id,
                    "class": b.class_name,
                    "confidence": "" if b.confidence is None else b.confidence,
                    "match": b.match,
                    "source": b.source,
                    "px_x": b.x,
                    "px_y": b.y,
                    "px_w": b.w,
                    "px_h": b.h,
                }
            )
            if georef is not None:
                corners, (cx, cy) = _native(georef, b)
                lons, lats = georef.native_to_wgs84(
                    [p[0] for p in corners] + [cx], [p[1] for p in corners] + [cy]
                )
                for i, (x, y) in enumerate(corners, start=1):
                    row[f"x{i}"], row[f"y{i}"] = x, y
                    row[f"lon{i}"], row[f"lat{i}"] = lons[i - 1], lats[i - 1]
                row.update({"epsg": epsg or "", "cx": cx, "cy": cy, "clon": lons[4], "clat": lats[4]})
                w_m = math.dist(corners[0], corners[1])
                h_m = math.dist(corners[1], corners[2])
                if georef.crs.is_geographic:  # corner distances are in degrees: use the GSD instead
                    mpp = georef.metres_per_pixel(1, 1)
                    w_m, h_m = b.w * mpp, b.h * mpp
                row.update({"width_m": w_m, "height_m": h_m, "area_m2": w_m * h_m})
            writer.writerow(row)


def write_geojson(
    path: Path, boxes: list[ExportBox], zones: list[tuple[str, str, list]], georef: Georef
) -> None:
    features = []
    for b in boxes:
        corners, _ = _native(georef, b)
        lons, lats = georef.native_to_wgs84([p[0] for p in corners], [p[1] for p in corners])
        ring = [[lo, la] for lo, la in zip(lons, lats, strict=True)]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
                "properties": {
                    "kind": b.kind,
                    "id": b.id,
                    "class": b.class_name,
                    "confidence": b.confidence,
                    "match": b.match,
                    "source": b.source,
                },
            }
        )
    for zone_id, name, polygon in zones:
        native = [georef.pixel_to_native(px, py) for px, py in polygon]
        lons, lats = georef.native_to_wgs84([p[0] for p in native], [p[1] for p in native])
        ring = [[lo, la] for lo, la in zip(lons, lats, strict=True)]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring + [ring[0]]]},
                "properties": {"kind": "zone", "id": zone_id, "name": name},
            }
        )
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), "utf-8")


def write_summary(path: Path, summary: dict) -> None:
    path.write_text(json.dumps(summary, indent=2, default=str), "utf-8")
