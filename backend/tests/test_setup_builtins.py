"""The three built-in project templates (spec 2026-09-30-project-setup section 5.1; plan
2026-09-30-setup-u1): exactly the spec's slots and types, valid against the pydantic models and the
contract, every type with a one- or two-sentence definition, and every slot promising only what an
existing importer takes (decision S1-5)."""

from pathlib import Path

import jsonschema_rs
import pytest
import yaml

from app.catalogue.handle import DEFAULT_SCALE
from app.catalogue.names import normalise_name
from app.datasets.prepare import IMAGE_EXTS
from app.drawings.detect import FORMATS as DRAWING_FORMATS
from app.maps.service import MAP_SUFFIXES
from app.pointclouds.lasfile import SUFFIXES as CLOUD_SUFFIXES
from app.setup.builtins import (
    BUILTIN_CONFINED,
    BUILTIN_IDS,
    BUILTIN_MAPPING,
    BUILTIN_TEMPLATES,
    BUILTIN_VERTICAL,
    SEEDED_AT,
)
from app.setup.schemas import ProjectTemplateOut, TemplateConfig

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
BY_ID = {t["id"]: t for t in BUILTIN_TEMPLATES}


def _bare(suffixes) -> set[str]:
    return {s.lstrip(".") for s in suffixes}


# What each route's importer takes today (`video` waits for S4; spec section 7.2).
IMPORTABLE = {
    "images": _bare(IMAGE_EXTS),
    "map": _bare(MAP_SUFFIXES),
    "elevation": {"tif", "tiff"},  # app/surfaces/elevation.py refuses anything else
    "pointcloud": _bare(CLOUD_SUFFIXES),
    "drawing": _bare(DRAWING_FORMATS),
    "video": {"mp4", "mov"},
}
# Spec section 5.1: (label, route, required) per slot. Confined's video slot is not required until
# video import (S4) lands; Stills is its required slot until then.
SLOTS = {
    BUILTIN_MAPPING: [
        ("Orthomosaic", "map", True),
        ("Elevation (DSM/DTM)", "elevation", False),
        ("Design surface / CAD", "drawing", False),
        ("Raw drone images", "images", False),
    ],
    BUILTIN_VERTICAL: [
        ("Visual photos", "images", True),
        ("Thermal photos", "images", False),
        ("3D point cloud", "pointcloud", False),
        ("Asset drawings", "drawing", False),
    ],
    BUILTIN_CONFINED: [
        ("Inspection video", "video", False),
        ("Stills", "images", True),
        ("LiDAR scan", "pointcloud", False),
        ("Structure drawings", "drawing", False),
    ],
}
# Spec section 5.1: (name, kind, default severity, hotkey) per type.
TYPES = {
    BUILTIN_MAPPING: [
        ("Stockpile", "object", 1, "1"),
        ("Erosion / washout", "defect", 3, "2"),
        ("Standing water", "defect", 2, "3"),
        ("Unapproved machinery", "object", 2, "4"),
        ("Slope failure", "defect", 4, "5"),
        ("Vegetation encroachment", "defect", 1, "6"),
    ],
    BUILTIN_VERTICAL: [
        ("Corrosion", "defect", 2, "1"),
        ("Coating damage", "defect", 1, "2"),
        ("Loose / missing bolt", "defect", 3, "3"),
        ("Antenna misalignment", "defect", 3, "4"),
        ("Bird nest", "object", 2, "5"),
        ("Thermal hot spot", "defect", 4, "6"),
        ("Cracked weld", "defect", 4, "7"),
    ],
    BUILTIN_CONFINED: [
        ("Pitting corrosion", "defect", 3, "1"),
        ("Weld crack", "defect", 4, "2"),
        ("Liner blistering", "defect", 2, "3"),
        ("Deposits / scale", "defect", 1, "4"),
        ("Wall deformation", "defect", 3, "5"),
        ("Leak / seepage", "defect", 4, "6"),
        ("Debris / foreign object", "object", 1, "7"),
    ],
}


def test_the_three_built_ins_in_order():
    assert [t["id"] for t in BUILTIN_TEMPLATES] == list(BUILTIN_IDS)
    assert BUILTIN_IDS == ("builtin-mapping", "builtin-vertical", "builtin-confined")
    assert [t["name"] for t in BUILTIN_TEMPLATES] == [
        "Mapping and survey",
        "Vertical asset inspection",
        "Confined space inspection",
    ]


@pytest.mark.parametrize("template_id", BUILTIN_IDS)
def test_the_slots_and_types_are_the_specs(template_id):
    config = BY_ID[template_id]["config"]
    assert [(s["label"], s["route"], s["required"]) for s in config["slots"]] == SLOTS[template_id]
    assert [(t["name"], t["kind"], t["default_severity"], t["hotkey"]) for t in config["types"]] == TYPES[
        template_id
    ]


@pytest.mark.parametrize("template_id", BUILTIN_IDS)
def test_each_built_in_is_valid_and_dumps_back_to_itself(template_id):
    template = BY_ID[template_id]
    assert TemplateConfig.model_validate(template["config"]).model_dump(mode="json") == template["config"]
    out = {**template, "builtin": True, "created_at": SEEDED_AT, "updated_at": SEEDED_AT}
    dumped = ProjectTemplateOut.model_validate(out).model_dump(mode="json")
    spec = yaml.safe_load(SPEC.read_text("utf-8"))
    validator = jsonschema_rs.Draft202012Validator(
        {"$ref": "#/components/schemas/ProjectTemplate", "components": spec["components"]}
    )
    assert [e.message for e in validator.iter_errors(dumped)] == []


@pytest.mark.parametrize("template_id", BUILTIN_IDS)
def test_what_invalid_template_would_refuse_never_happens_in_a_built_in(template_id):
    config = BY_ID[template_id]["config"]
    keys = [s["key"] for s in config["slots"]]
    names = [normalise_name(t["name"]) for t in config["types"]]
    hotkeys = [t["hotkey"] for t in config["types"]]
    colours = [t["colour"] for t in config["types"]]
    for values in (keys, names, hotkeys, colours):
        assert len(set(values)) == len(values), values
    assert all(c == c.lower() for c in colours)


@pytest.mark.parametrize("template_id", BUILTIN_IDS)
def test_every_type_has_a_short_definition_empty_rules_and_a_default_scale_severity(template_id):
    top = max(level for level, _, _ in DEFAULT_SCALE)
    for t in BY_ID[template_id]["config"]["types"]:
        text = t["definition"]
        assert text.endswith(".") and 20 <= len(text) <= 300, t["name"]
        assert 1 <= text.count(". ") + 1 <= 2, t["name"]  # one or two sentences
        assert t["severity_rules"] == [], t["name"]  # S2 fills them
        assert 1 <= t["default_severity"] <= top, t["name"]


@pytest.mark.parametrize("template_id", BUILTIN_IDS)
def test_a_slot_promises_only_what_its_importer_takes(template_id):
    for slot in BY_ID[template_id]["config"]["slots"]:
        assert set(slot["accepts"]) <= IMPORTABLE[slot["route"]], slot["key"]
        assert "dng" not in slot["accepts"], slot["key"]  # index S-R10


def test_the_match_splits_the_routes_the_classifier_splits():
    vertical = {s["key"]: s["match"] for s in BY_ID[BUILTIN_VERTICAL]["config"]["slots"]}
    assert (vertical["visual"], vertical["thermal"]) == ({"thermal": False}, {"thermal": True})
    mapping = {s["key"]: s["match"] for s in BY_ID[BUILTIN_MAPPING]["config"]["slots"]}
    assert (mapping["ortho"], mapping["elevation"]) == ({"raster": "ortho"}, {"raster": "elevation"})
