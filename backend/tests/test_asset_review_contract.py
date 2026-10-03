"""P1's models and the contract schemas name the same fields (spec 2026-10-02-asset-findings §5.1):
`asset_model.frame` and `asset_model.review` are stored as `Frame` and `ReviewConfig` dumps and
served as `AssetFrame` and `AssetReviewConfig`."""

from pathlib import Path

import yaml

from app.asset_review.frame import Frame, Origin, Preset
from app.asset_review.profiles import (
    ComponentRule,
    Focus,
    Limit,
    ReportOptions,
    ReviewConfig,
    ReviewZone,
    Sides,
    resolve,
)

CONTRACT = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
PAIRS = {
    "AssetFrame": Frame,
    "AssetFrameOrigin": Origin,
    "AssetFramePreset": Preset,
    "AssetReviewConfig": ReviewConfig,
    "AssetReviewZone": ReviewZone,
    "AssetReviewSides": Sides,
    "AssetReviewFocus": Focus,
    "AssetReviewReport": ReportOptions,
    "AssetReviewComponentRule": ComponentRule,
    "AssetReviewLimit": Limit,
}


def _schemas() -> dict:
    return yaml.safe_load(CONTRACT.read_text("utf-8"))["components"]["schemas"]


def test_every_frame_and_review_schema_has_the_models_fields():
    schemas = _schemas()
    for name, model in PAIRS.items():
        assert set(schemas[name]["properties"]) == set(model.model_fields), name
        assert schemas[name].get("additionalProperties") is False, name


def test_a_resolved_review_carries_every_required_field():
    required = set(_schemas()["AssetReviewConfig"]["required"])
    for pid in ("stack", "building_facade", "ohtl_tower"):
        assert set(resolve(pid, 60.0).model_dump(mode="json")) == required
