"""The Overview (spec 2026-09-26-foundation section 9.1) and the Projects list summary (section
9.2), from pre-aggregated rows only: `finding_count`, `finding_daily`, the type snapshots, small-table
COUNTs and SUM(source.image_count). Nothing here reads `finding`, `box` or `image` (a statement
counter in tests/test_overview.py pins it), except `project_summary`'s cover, which takes the newest
image by rowid: one row, no scan. `photo_review` groups `image_review`, at most one row per reviewed
photo."""

import logging
from collections.abc import Callable

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.catalogue import service as catalogue_service
from app.db.models import (
    AssetModel,
    Drawing,
    GeoMap,
    ImageReview,
    PointCloud,
    Source,
    Surface,
    VolumeMeasurement,
)
from app.findings import counts, query

LATEST_VOLUME_WINDOW = 21  # the newest ready measurement and the 20 before it, looking for its polygon
log = logging.getLogger(__name__)

BANNER_PROVIDERS: list[Callable] = []


def banner_provider(fn: Callable) -> Callable:
    """Register `fn(handle) -> list[banner dict]`; MG adds its migration banner this way."""
    BANNER_PROVIDERS.append(fn)
    return fn


def data_counts(s: Session) -> dict:
    """One statement: the data chips of KPI 3 (spec section 9.1)."""
    row = s.execute(
        select(
            select(func.count())
            .select_from(Source)
            .where(Source.kind == "images")
            .scalar_subquery()
            .label("image_sets"),
            select(func.coalesce(func.sum(Source.image_count), 0))
            .where(Source.kind == "images")
            .scalar_subquery()
            .label("images"),
            select(func.count()).select_from(GeoMap).scalar_subquery().label("maps"),
            select(func.count()).select_from(Surface).scalar_subquery().label("elevations"),
            select(func.count()).select_from(PointCloud).scalar_subquery().label("point_clouds"),
            select(func.count()).select_from(Drawing).scalar_subquery().label("drawings"),
        )
    ).one()
    return row._asdict()


def hero_map_id(s: Session) -> str | None:
    """The newest ready map by capture date (undated last), then by import."""
    return s.execute(
        select(GeoMap.id)
        .where(GeoMap.status == "ready")
        .order_by(GeoMap.captured_on.is_(None), GeoMap.captured_on.desc(), GeoMap.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def newest_ready_cloud_id(s: Session) -> str | None:
    """The newest ready point cloud by capture date (undated last), then by import."""
    return s.execute(
        select(PointCloud.id)
        .where(PointCloud.status == "ready")
        .order_by(
            PointCloud.captured_on.is_(None), PointCloud.captured_on.desc(), PointCloud.created_at.desc()
        )
        .limit(1)
    ).scalar_one_or_none()


REVIEW_STATUSES = ("finding", "none", "uncertain", "not_assessed")


def hero_asset_model_id(s: Session) -> str | None:
    """The newest built asset model with a review profile (asset findings spec section 9). A JSON
    null and an SQL NULL both mean "no profile"."""
    return s.execute(
        select(AssetModel.id)
        .where(
            AssetModel.status == "ready",
            AssetModel.current_version.is_not(None),
            func.coalesce(func.json_type(AssetModel.review), "null") != "null",
        )
        .order_by(AssetModel.updated_at.desc(), AssetModel.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def photo_review(s: Session, images: int) -> dict | None:
    """Photos by review status; None until any photo has one (spec section 5.4). A photo with no
    review row is not assessed, so the project's image count tops that bucket up (no extra read)."""
    rows = s.execute(select(ImageReview.status, func.count()).group_by(ImageReview.status)).all()
    if not rows:
        return None
    out = dict.fromkeys(REVIEW_STATUSES, 0)
    for status, n in rows:
        out[status] = n
    out["not_assessed"] += max(0, images - sum(n for _, n in rows))
    return out


def hero(s: Session, data: dict, map_id: str | None) -> dict | None:
    """Spec 2026-09-30-project-landing section 4.1, with the asset model first (asset findings spec
    section 9). Every candidate is read every time, so the Overview's statement count does not
    depend on what the project holds."""
    asset_id = hero_asset_model_id(s)
    cloud_id = newest_ready_cloud_id(s)
    drawing_id = s.execute(
        select(Drawing.id)
        .where(Drawing.status == "ready")
        .order_by(Drawing.created_at.desc(), Drawing.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if asset_id:
        return {"kind": "asset_model", "id": asset_id}
    if map_id:
        return {"kind": "map", "id": map_id}
    if cloud_id:
        return {"kind": "point_cloud", "id": cloud_id}
    if data["images"] > 0:
        return {"kind": "images", "id": None}
    if drawing_id:
        return {"kind": "drawing", "id": drawing_id}
    return None


def latest_volume(s: Session) -> dict | None:
    """KPI 4: the newest ready volume measurement's net volume, and the previous ready measurement's
    over the same polygon (the client shows the delta)."""
    rows = (
        s.execute(
            select(VolumeMeasurement)
            .where(VolumeMeasurement.status == "ready")
            .order_by(VolumeMeasurement.created_at.desc(), VolumeMeasurement.id.desc())
            .limit(LATEST_VOLUME_WINDOW)
        )
        .scalars()
        .all()
    )
    if not rows:
        return None
    newest = rows[0]
    previous = next((r for r in rows[1:] if r.polygon_native == newest.polygon_native), None)
    return {
        "measurement_id": newest.id,
        "name": newest.name,
        "net_m3": (newest.results or {}).get("net_m3"),
        "previous_net_m3": (previous.results or {}).get("net_m3") if previous is not None else None,
    }


@banner_provider
def _types_to_classify(handle) -> list[dict]:
    if handle.catalogue is None:
        return []
    flag = catalogue_service.get_meta(handle.catalogue, catalogue_service.NEEDS_CLASSIFICATION)
    if not flag:
        return []
    n = flag.get("count") if isinstance(flag, dict) else None
    lead = f"{n} types came" if n else "Some types came"
    return [
        {
            "kind": "types_to_classify",
            "tone": "info",
            "message": f"{lead} from your existing projects. Mark which are defects.",
            "action": "/catalogue?origin=migrated",
        }
    ]


@banner_provider
def _model_adoption(handle) -> list[dict]:
    from app.library import adoption  # the library package is optional at import time

    status = adoption.adoption_status(handle)
    if status["missing"]:
        n = len(status["missing"])
        return [
            {
                "kind": "model_adoption",
                "tone": "warn",
                "message": f"{n} of this project's models could not be moved into the library.",
                "action": "/models/library",
            }
        ]
    if status["pending"]:
        return [
            {
                "kind": "model_adoption",
                "tone": "info",
                "message": f"Moving {status['pending']} of this project's models into the library.",
                "action": None,
            }
        ]
    return []


def build(handle) -> dict:
    levels = catalogue_service.scale_levels(handle.catalogue)
    with handle.session() as s:
        data = data_counts(s)
        map_id = hero_map_id(s)
        payload = {
            "findings": query.summary(s, levels=levels),
            "data": data,
            "latest_volume": latest_volume(s),
            "hero_map_id": map_id,
            "hero": hero(s, data, map_id),
            "photo_review": photo_review(s, data["images"]),
        }
    banners: list[dict] = []
    for provider in BANNER_PROVIDERS:
        try:
            banners += provider(handle)
        except Exception:  # a banner is never the reason the Overview fails
            log.exception(
                "overview banner %s failed for project %s",
                getattr(provider, "__name__", provider),
                handle.id,
            )
    return {**payload, "banners": banners}


def project_summary(s: Session, top_level: int) -> dict:
    """`ProjectOut.summary` (spec section 9.2): the same pre-aggregated reads."""
    data = data_counts(s)
    open_total, by_level = counts.open_now(s)
    hero = hero_map_id(s)
    cover = {"kind": "map", "id": hero} if hero else None
    if cover is None:
        newest = s.execute(text("SELECT id FROM image ORDER BY rowid DESC LIMIT 1")).scalar_one_or_none()
        cover = {"kind": "image", "id": newest} if newest else None
    return {
        "image_count": data["images"],
        "maps": data["maps"],
        "point_clouds": data["point_clouds"],
        "elevations": data["elevations"],
        "open_findings": open_total,
        "open_top_severity": by_level.get(str(top_level), 0),
        "cover": cover,
    }
