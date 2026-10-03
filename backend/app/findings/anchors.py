"""Finding anchors (spec 2026-09-26-foundation section 8.1): exactly one of an image annotation, a
map geometry in the map's CRS, a cloud point in the cloud's CRS, or an asset model with its sightings
(spec 2026-10-02-asset-findings §5.5). `resolve` checks the target
exists and returns the finding's anchor columns, its data item (for filters) and its WGS84 location
(for the Overview's pins)."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, Box, Finding, GeoMap, Image, PointCloud
from app.errors import AppError, not_found
from app.findings.numbers import format_number

log = logging.getLogger(__name__)
KINDS = ("image", "map", "cloud", "asset")
_EMPTY = dict.fromkeys(
    (
        "image_id",
        "annotation_id",
        "map_id",
        "geometry",
        "cloud_id",
        "x",
        "y",
        "z",
        "uncertainty_m",
        "asset_model_id",
        "asset_version",
    )
)


@dataclass
class AnchorIn:
    kind: str  # image | map | cloud | asset
    image_id: str | None = None
    annotation_id: str | None = None
    box: dict | None = None  # {x, y, w, h, angle}: POST /findings draws the box (Task 11)
    map_id: str | None = None
    geometry: dict | None = None
    cloud_id: str | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None
    uncertainty_m: float | None = None
    asset_model_id: str | None = None
    # [{image_id, box, points, severity, group_tag}]: POST /findings draws them
    sightings: list[dict] | None = None


def _finite(*values) -> bool:
    return all(v is not None and math.isfinite(v) for v in values)


def _invalid(message: str) -> AppError:
    return AppError("invalid_geometry", message, 422)


def check_geometry(geometry) -> dict:
    """A GeoJSON Point, or a Polygon whose one ring is closed and has at least four positions."""
    try:
        kind = geometry["type"]
        coords = geometry["coordinates"]
        if kind == "Point":
            points = [coords]
        elif kind == "Polygon":
            points = coords[0]
            if len(points) < 4 or list(points[0]) != list(points[-1]):
                raise ValueError("the ring is not closed")
        else:
            raise ValueError(kind)
        clean = [[float(p[0]), float(p[1])] for p in points]
        if not all(math.isfinite(v) for p in clean for v in p):
            raise ValueError("not finite")
    except (KeyError, TypeError, ValueError, IndexError):
        raise _invalid("A map anchor needs a GeoJSON Point or a closed Polygon.") from None
    return {"type": kind, "coordinates": clean[0] if kind == "Point" else [clean]}


def centroid(geometry: dict) -> tuple[float, float]:
    if geometry["type"] == "Point":
        x, y = geometry["coordinates"]
        return float(x), float(y)
    ring = geometry["coordinates"][0][:-1]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def to_wgs84(crs_wkt: str | None, x: float, y: float) -> tuple[float | None, float | None]:
    """A native point in WGS84, or (None, None) without a CRS or when projecting fails: a finding
    without a location is still a finding; it just has no pin."""
    if not crs_wkt:
        return None, None
    try:
        from pyproj import CRS, Transformer

        t = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True)
        lon, lat = t.transform(x, y)
    except Exception:
        log.warning("could not place (%s, %s) in WGS84", x, y, exc_info=True)
        return None, None
    return (float(lon), float(lat)) if _finite(lon, lat) else (None, None)


def _image(s: Session, a: AnchorIn) -> dict:
    image = s.get(Image, a.image_id) if a.image_id else None
    if image is None:
        raise not_found("image", str(a.image_id))
    box = s.get(Box, a.annotation_id) if a.annotation_id else None
    if box is None or box.image_id != image.id:
        raise not_found("annotation", str(a.annotation_id))
    taken = s.execute(select(Finding.id, Finding.number).where(Finding.annotation_id == box.id)).first()
    if taken is not None:
        raise AppError(
            "conflict",
            f"That annotation is already {format_number(taken.number)}.",
            409,
            {"finding_id": taken.id},
        )
    return {
        **_EMPTY,
        "anchor_kind": "image",
        "image_id": image.id,
        "annotation_id": box.id,
        "lon": image.lon,
        "lat": image.lat,
        "data_type": "image_set",
        "data_id": image.source_id,
    }


def _map(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    gmap = s.get(GeoMap, a.map_id) if a.map_id else None
    if gmap is None:
        raise not_found("map", str(a.map_id))
    geometry = check_geometry(a.geometry)
    if not _finite(lon, lat):
        lon, lat = to_wgs84(gmap.crs_wkt, *centroid(geometry))
    return {
        **_EMPTY,
        "anchor_kind": "map",
        "map_id": gmap.id,
        "geometry": geometry,
        "lon": lon,
        "lat": lat,
        "data_type": "map",
        "data_id": gmap.id,
    }


def _cloud(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    cloud = s.get(PointCloud, a.cloud_id) if a.cloud_id else None
    if cloud is None:
        raise not_found("point cloud", str(a.cloud_id))
    if not _finite(a.x, a.y, a.z):
        raise _invalid("A cloud anchor needs finite x, y and z.")
    if a.uncertainty_m is not None and not (math.isfinite(a.uncertainty_m) and a.uncertainty_m >= 0):
        raise _invalid("uncertainty_m must be a finite number of metres, 0 or more.")
    if not _finite(lon, lat):
        lon, lat = to_wgs84(cloud.crs_wkt, a.x, a.y)
    return {
        **_EMPTY,
        "anchor_kind": "cloud",
        "cloud_id": cloud.id,
        "x": float(a.x),
        "y": float(a.y),
        "z": float(a.z),
        "uncertainty_m": a.uncertainty_m,
        "lon": lon,
        "lat": lat,
        "data_type": "point_cloud",
        "data_id": cloud.id,
    }


def _asset(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    model = s.get(AssetModel, a.asset_model_id) if a.asset_model_id else None
    if model is None:
        raise not_found("asset model", str(a.asset_model_id))
    if not _finite(lon, lat):
        origin = (model.frame or {}).get("origin") or {}
        lon, lat = origin.get("lon"), origin.get("lat")
        lon, lat = (float(lon), float(lat)) if _finite(lon, lat) else (None, None)
    return {
        **_EMPTY,
        "anchor_kind": "asset",
        "asset_model_id": model.id,
        "asset_version": model.current_version,
        "lon": lon,
        "lat": lat,
        "data_type": "asset_model",
        "data_id": model.id,
    }


def resolve(s: Session, anchor: AnchorIn, *, lon: float | None = None, lat: float | None = None) -> dict:
    """The finding columns for `anchor`. A map or cloud caller may pass its own `lon`/`lat` (M's map
    review does, spec section 8.5); otherwise they are projected from the target's CRS."""
    if anchor.kind == "image":
        return _image(s, anchor)
    if anchor.kind == "map":
        return _map(s, anchor, lon, lat)
    if anchor.kind == "cloud":
        return _cloud(s, anchor, lon, lat)
    if anchor.kind == "asset":
        return _asset(s, anchor, lon, lat)
    raise AppError("validation_error", f"unknown anchor kind {anchor.kind!r}", 422)


def repatch(s: Session, row: Finding, patch: dict) -> dict:
    """The column changes for PATCH `anchor`: a map finding's geometry or a cloud finding's point.
    An image finding moves with its box and an asset finding with its sightings, never through here."""
    if row.anchor_kind == "image":
        raise AppError("anchor_immutable", "An image finding moves with its annotation; edit the box.", 422)
    if row.anchor_kind == "asset":
        raise AppError(
            "anchor_immutable", "An asset finding moves with its sightings; edit their boxes.", 422
        )
    if row.anchor_kind == "map":
        if patch.get("geometry") is None:
            return {}
        cols = _map(s, AnchorIn(kind="map", map_id=row.map_id, geometry=patch["geometry"]), None, None)
        return {k: cols[k] for k in ("geometry", "lon", "lat")}
    moved = AnchorIn(
        kind="cloud",
        cloud_id=row.cloud_id,
        x=patch.get("x", row.x),
        y=patch.get("y", row.y),
        z=patch.get("z", row.z),
        uncertainty_m=patch.get("uncertainty_m", row.uncertainty_m),
    )
    cols = _cloud(s, moved, None, None)
    return {k: cols[k] for k in ("x", "y", "z", "uncertainty_m", "lon", "lat")}
