"""Review profiles and `resolve` (spec 2026-10-02-asset-findings §7, §5.1 `review`)."""

import json
import re

import pytest
from pydantic import ValidationError

from app.asset_review.profiles import (
    COMPASS,
    PROFILES,
    ReviewConfig,
    UnknownProfile,
    profile_id_for_kit,
    resolve,
)

DASHES = re.compile("[\u2013\u2014]")


def _zones(cfg: ReviewConfig) -> list[tuple]:
    return [(z.id, z.min_m, z.max_m) for z in cfg.zones]


def test_the_five_built_in_profiles():
    assert list(PROFILES) == ["stack", "building_facade", "tank", "telecom_tower", "ohtl_tower"]
    units = {k: (p.finding_unit, p.placement, p.sides.type) for k, p in PROFILES.items()}
    assert units == {
        "stack": ("photo", "patch", "compass"),
        "building_facade": ("region", "mixed", "faces"),
        "tank": ("region", "patch", "compass"),
        "telecom_tower": ("region", "point", "compass"),
        "ohtl_tower": ("region", "point", "faces"),
    }


def test_resolve_stack_turns_fractions_into_metres_top_first():
    cfg = resolve("stack", 80.0)
    assert _zones(cfg) == [("head", 73.6, None), ("shaft", 15.2, 73.6), ("base", None, 15.2)]
    assert cfg.profile_id == "stack" and cfg.finding_unit == "photo" and cfg.placement == "patch"
    assert cfg.cluster_m == 1.6  # max(0.75, 0.02 H)
    assert cfg.patch_grid == 48
    assert cfg.sides.labels == list(COMPASS) and cfg.sides.basis == "position"
    assert (cfg.report.pages, cfg.report.min_severity) == ("finding", 1)
    assert cfg.focus.frustum == (0.05, 0.125) and cfg.focus.oblique_deg == 0.0
    assert cfg.facts[:3] == ["severity", "height", "zone"]
    assert [lim.title for lim in cfg.limits] == ["Visual only", "Draft, unvalidated", "Approximate positions"]


def test_resolve_building_facade_keeps_its_own_settings():
    cfg = resolve("building_facade", 74.4)
    assert _zones(cfg) == [
        ("roof", 65.472, None),
        ("upper", 40.92, 65.472),
        ("middle", 22.32, 40.92),
        ("lower", 11.904, 22.32),
        ("podium", None, 11.904),
    ]
    assert (cfg.cluster_m, cfg.patch_grid, cfg.placement) == (1.5, 14, "mixed")
    assert (cfg.sides.type, cfg.sides.basis) == ("faces", "normal")
    assert cfg.sides.labels == ["North elevation", "East elevation", "South elevation", "West elevation"]
    assert cfg.focus.frustum == (0.14, 0.26) and cfg.focus.oblique_deg == 28.0
    assert (cfg.report.pages, cfg.report.min_severity) == ("defect", 2)
    assert cfg.component_map == []


def test_resolve_ohtl_faces_relative_to_the_line():
    cfg = resolve("ohtl_tower", 50.0)
    assert _zones(cfg) == [
        ("peak", 44.0, None),
        ("arms", 27.5, 44.0),
        ("body", 6.0, 27.5),
        ("legs", None, 6.0),
    ]
    assert cfg.sides.labels == ["Line ahead", "Right face", "Line back", "Left face"]
    assert cfg.sides.basis == "position" and cfg.cluster_m == 1.0


def test_cluster_has_a_floor_of_three_quarters_of_a_metre():
    assert resolve("telecom_tower", 20.0).cluster_m == 0.75
    assert resolve("tank", 30.0).cluster_m == 0.75
    assert resolve("telecom_tower", 42.0).cluster_m == 0.84


def test_metre_zones_override_in_either_key_form_and_are_sorted_top_first():
    cfg = resolve(
        "building_facade",
        60.0,
        {
            "zones": [
                {"id": "podium", "label": "Podium", "max": 12},
                {"id": "crown", "label": "Roof and crown", "min_m": 55},
                {"id": "L01", "label": "Level 01", "min": 12, "max_m": 55.0},
            ]
        },
    )
    assert _zones(cfg) == [("crown", 55.0, None), ("L01", 12.0, 55.0), ("podium", None, 12.0)]


def test_overrides_deep_merge_over_the_profile():
    cfg = resolve(
        "building_facade",
        60.0,
        {"sides": {"title": "Elevation"}, "report": {"min_severity": 3}, "cluster_m": 2.0, "patch_grid": 20},
    )
    assert cfg.sides.title == "Elevation" and cfg.sides.type == "faces" and len(cfg.sides.labels) == 4
    assert (cfg.report.pages, cfg.report.min_severity) == ("defect", 3)
    assert (cfg.cluster_m, cfg.patch_grid) == (2.0, 20)


def test_compass_sides_always_carry_the_eight_points():
    cfg = resolve("building_facade", 60.0, {"sides": {"type": "compass"}})
    assert cfg.sides.labels == list(COMPASS)


def test_unknown_profile_bad_height_and_bad_overrides_are_rejected():
    with pytest.raises(UnknownProfile):
        resolve("chimney", 10.0)
    with pytest.raises(ValueError):
        resolve("stack", 0.0)
    with pytest.raises(ValidationError):
        resolve("stack", 10.0, {"colour": "red"})
    with pytest.raises(ValidationError):
        resolve("stack", 10.0, {"report": {"min_severity": 4}})
    with pytest.raises(ValidationError):
        resolve("ohtl_tower", 10.0, {"sides": {"labels": ["Only one"]}})


def test_kit_profile_names_map_to_ids():
    assert profile_id_for_kit("building-facade") == "building_facade"
    assert profile_id_for_kit("ohtl-tower") == "ohtl_tower"
    assert profile_id_for_kit("stack") == "stack"
    with pytest.raises(UnknownProfile):
        profile_id_for_kit("pipeline")


def test_profile_text_has_no_em_or_en_dashes():
    text = json.dumps([p.model_dump(mode="json") for p in PROFILES.values()], ensure_ascii=False)
    assert not DASHES.search(text)


def test_a_review_round_trips_through_json():
    for pid in PROFILES:
        cfg = resolve(pid, 33.3)
        assert ReviewConfig.model_validate(json.loads(json.dumps(cfg.model_dump(mode="json")))) == cfg
