"""Asset models as compose reads them (spec 2026-10-02-asset-findings §5.1, §10): one small dict per
compose context (tens of rows, never findings), and the representative sighting of a finding."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from app.asset_review.frame import Frame
from app.asset_review.profiles import ReviewConfig
from app.db.models import AssetModel, Finding, FindingSighting

log = logging.getLogger(__name__)
PLACED = ("point", "patch")
NOT_PLACED = "Not placed"  # the one copy for a finding without a height, zone or side
ASSET = Finding.anchor_kind == "asset"  # the asset-finding predicate, ANDed via `where=`


@dataclass(frozen=True)
class AssetInfo:
    id: str
    name: str
    current_version: int | None
    frame: Frame | None
    review: ReviewConfig | None

    def zone_label(self, zone_id: str | None) -> str | None:
        if zone_id is None or self.review is None:
            return zone_id
        for z in self.review.zones:
            if z.id == zone_id:
                return z.label
        return zone_id


def _parse(model: Any, raw: Any, model_id: str, what: str):
    if raw is None:
        return None
    try:
        return model.model_validate(raw)
    except Exception:
        log.warning("asset model %s has an unreadable %s; reports leave it out", model_id, what)
        return None


def load_asset_models(handle) -> dict[str, AssetInfo]:
    with handle.session() as s:
        rows = s.execute(
            select(
                AssetModel.id,
                AssetModel.name,
                AssetModel.current_version,
                AssetModel.frame,
                AssetModel.review,
            )
        ).all()
    return {
        mid: AssetInfo(
            mid, name, cur, _parse(Frame, frame, mid, "frame"), _parse(ReviewConfig, review, mid, "review")
        )
        for mid, name, cur, frame, review in rows
    }


def representative(s, finding_id: str) -> FindingSighting | None:
    """Spec §6.4: maximum severity, then placed, then largest coverage; oldest, then id, breaks ties."""
    q = (
        select(FindingSighting)
        .where(FindingSighting.finding_id == finding_id)
        .order_by(
            FindingSighting.severity.is_(None),
            FindingSighting.severity.desc(),
            FindingSighting.placement.not_in(PLACED),
            func.coalesce(FindingSighting.coverage, 0.0).desc(),  # None is 0, as in sightings.sort_key
            FindingSighting.created_at,
            FindingSighting.id,
        )
        .limit(1)
    )
    return s.execute(q).scalar_one_or_none()
