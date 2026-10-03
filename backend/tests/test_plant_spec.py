"""The plant spec models (spec 2026-10-03-plant-model-generator §5; plan pm-f0 Task 2)."""

import math

import pytest
from pydantic import ValidationError

from app.asset_models.spec import MAX_ITEMS, AssetSpec, Item, SiteFrame

M1_SPEC = {
    "asset": {"tag": "710-D-130335"},
    "parts": [
        {
            "id": "shell",
            "name": "Shell",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 4000, "thickness": 8, "height": 8000},
            "source": {"kind": "drawing", "id": "d1", "region": [0.1, 0.1, 0.4, 0.3]},
        }
    ],
}
FRAME = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "drawing", "id": "d-t0003", "page": 1},
}


def item(**over) -> dict:
    base = {
        "id": "20-T-0001",
        "tag": "20-T-0001",
        "name": "LNG storage tank",
        "type": "tank_lng",
        "area": "20",
        "footprint": {"kind": "circle", "center": [1326.0, 520.0], "d": 92.0},
        "base_el": 104.5,
        "top_el": 151.0,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d-t0006", "page": 1, "region": [0.2, 0.2, 0.5, 0.5]},
        "confidence": "high",
    }
    base.update(over)
    return base


def test_an_m1_spec_round_trips_unchanged():
    """Review Focus 1: a pre-G1 spec has no site, items or environment and still loads as before."""
    spec = AssetSpec.model_validate(M1_SPEC)
    assert spec.site is None and spec.items == [] and spec.environment == []
    again = AssetSpec.model_validate(spec.model_dump(mode="json"))
    assert again == spec
    assert again.parts[0].source.page is None


def test_a_plant_spec_round_trips():
    raw = {
        "site": FRAME,
        "items": [
            item(),
            item(
                id="rack-1",
                tag=None,
                type="pipe_rack",
                footprint={"kind": "line", "pts": [[1200, 400], [1400, 400]], "width": 8},
                params={"tiers": 2},
                flags=[{"code": "plan_offset", "value": 1.4}],
            ),
            item(id="b1", type="building", footprint={"kind": "rect", "center": [10, 20], "size": [30, 12]}),
            item(id="p1", type="paved", footprint={"kind": "polygon", "pts": [[0, 0], [10, 0], [10, 10]]}),
        ],
        "environment": [
            {
                "id": "sea",
                "kind": "sea",
                "pts": [[0, 0], [100, 0], [100, 100]],
                "el": 92.5,
                "source": {"kind": "assumed"},
            }
        ],
    }
    spec = AssetSpec.model_validate(raw)
    assert spec.site.datum.label == "HPFS" and spec.site.cloud_z_to_el is None
    assert [i.footprint.kind for i in spec.items] == ["circle", "line", "rect", "polygon"]
    assert spec.items[2].footprint.rot_deg == 0
    assert AssetSpec.model_validate(spec.model_dump(mode="json")) == spec


def test_an_operator_source_needs_no_id_and_other_sources_still_do():
    frame = SiteFrame.model_validate({**FRAME, "source": {"kind": "operator"}})
    assert frame.source.kind == "operator" and frame.datum.el_m == 100.0
    with pytest.raises(ValidationError, match="needs its id"):
        Item.model_validate(item(source={"kind": "drawing"}))


@pytest.mark.parametrize(
    "bad",
    [
        {"footprint": {"kind": "circle", "center": [math.nan, 0], "d": 5}},
        {"footprint": {"kind": "circle", "center": [0, 0], "d": 0}},
        {"footprint": {"kind": "rect", "center": [0, 0], "size": [5, -1]}},
        {"footprint": {"kind": "polygon", "pts": [[0, 0], [1, 1]]}},
        {"footprint": {"kind": "line", "pts": [[0, 0]], "width": 2}},
        {"footprint": {"kind": "hexagon", "center": [0, 0]}},
        {"id": "has space"},
        {"name": ""},
        {"type": ""},
        {"base_el": math.inf},
        {"flags": [{"code": "made_up"}]},
        {"height_source": "guess"},
        {"source": {"kind": "drawing", "id": "d1", "page": 0}},
        {"surprise": 1},
    ],
)
def test_bad_items_are_refused_by_the_schema(bad):
    with pytest.raises(ValidationError):
        Item.model_validate(item(**bad))


def test_item_type_is_a_free_string_in_the_schema():
    """Spec §15: the registry, not the schema, judges the type (validate() reports unknown ones)."""
    assert Item.model_validate(item(type="made_up_type")).type == "made_up_type"


def test_the_item_count_is_capped_by_the_schema():
    one = item(id="x")
    with pytest.raises(ValidationError, match="at most 20000"):
        AssetSpec.model_validate({"items": [one] * (MAX_ITEMS + 1)})
