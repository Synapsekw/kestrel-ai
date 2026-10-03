"""Reading a review kit folder (spec 2026-10-02-asset-findings §6.5 steps 1, 2)."""

import json

import pytest
import yaml
from kit_fixtures import TRIANGLE, make_photo_kit, make_region_kit

from app.asset_review.kit_format import KitError, preview_size, read_kit, severity_of


def test_reads_a_region_kit(tmp_path):
    kit = read_kit(make_region_kit(tmp_path / "kit"))
    assert (kit.kit_profile, kit.profile_id, kit.unit) == ("building-facade", "building_facade", "region")
    assert [p.id for p in kit.photos] == ["p01", "p02", "p03"]
    assert kit.photos[0].source_name == "flight-a/DJI_0001.JPG" and kit.photos[0].hfov == 40.0
    f1, f2, f3 = kit.findings
    assert (f1.key, f1.cls, f1.severity, f1.group, f1.polygon) == ("p01-1", "cladding", 2, "g1", TRIANGLE)
    assert f2.polygon is None and f2.bbox == (1000.0, 1000.0, 1200.0, 1300.0)
    assert f3.component == "Navy fin" and f3.order == 2
    assert kit.statuses["p03"]["status"] == "uncertain"
    assert kit.sequences == {"1": "Flight A", "2": "Flight B"}
    assert kit.surface_path.name == "surface.json" and kit.glb_path is None and kit.mask_dir is None
    assert kit.alignment["origin"] == [25.0, 55.0, 0.0]


def test_reads_a_photo_kit(tmp_path):
    kit = read_kit(make_photo_kit(tmp_path / "kit"))
    assert (kit.profile_id, kit.unit, kit.findings) == ("stack", "photo", [])
    assert kit.statuses["p001"] == {
        "status": "finding",
        "note": "Rust at the seam",
        "severity": 2,
        "coverage": 1.25,
        "uncertain": 0.5,
    }
    assert kit.statuses["p002"]["severity"] is None  # the kit writes 0 for "no grade"
    assert kit.statuses["p003"]["status"] == "not_assessed"
    assert kit.mask_path("p001").name == "p001.png" and kit.mask_path("p002") is None
    assert kit.photo_unit_key(2) == "moderate" and kit.photo_unit_key(None) == "light"
    assert kit.finding_class_ids() == {1, 2, 3} and kit.uncertain_class_ids() == {4}


def test_preview_grid_prefers_the_mask_then_the_long_edge_rule(tmp_path):
    region = read_kit(make_region_kit(tmp_path / "r"))
    assert preview_size(region, region.photos[0]) == (2560, 1920)
    photo = read_kit(make_photo_kit(tmp_path / "p"))
    assert preview_size(photo, photo.photos[0]) == (1000, 750)  # the mask's own size
    assert preview_size(photo, photo.photos[1]) == (1000, 750)  # no mask: under 2560 px, unchanged


def test_damac_sized_photo_rounds_like_the_kit(tmp_path):
    kit = read_kit(make_region_kit(tmp_path / "kit"))
    big = kit.photos[0].__class__(id="x", name="x", source_name="x", width=8192, height=5460)
    assert preview_size(kit, big) == (2560, 1706)  # DAMAC's P1 frames, kit/cameras.py rounding


def test_unknown_profile_is_refused(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    text = (root / "job.yaml").read_text("utf-8").replace("building-facade", "bridge-deck")
    (root / "job.yaml").write_text(text, "utf-8")
    with pytest.raises(KitError, match="bridge-deck"):
        read_kit(root)


def test_missing_cameras_is_refused(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    (root / "cameras.json").unlink()
    with pytest.raises(KitError, match="cameras.json"):
        read_kit(root)


def test_merged_entries_match_on_photo_class_and_box(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    merged = json.loads((root / "merged.json").read_text("utf-8"))
    merged[0]["bbox"] = [100.0, 200.0, 500.0, 600.05]  # rounds to the same 0.1 px key
    (root / "merged.json").write_text(json.dumps(merged), "utf-8")
    assert read_kit(root).findings[0].polygon == TRIANGLE


@pytest.mark.parametrize(
    ("value", "level"),
    [
        (2, 2),
        ("3", 3),
        ("Moderate", 2),
        ("light", 1),
        ("Severe", 3),
        ("Critical", 3),
        (0, None),
        (None, None),
        ("x", None),
    ],
)
def test_severity_mapping(value, level):
    assert severity_of(value) == level


@pytest.mark.parametrize("size", [(0, 100), (100, 0), (-5, 100)])
def test_photo_without_a_positive_size_is_refused(tmp_path, size):
    root = make_region_kit(tmp_path / "kit")
    cams = json.loads((root / "cameras.json").read_text("utf-8"))
    cams["photos"][0]["width"], cams["photos"][0]["height"] = size
    (root / "cameras.json").write_text(json.dumps(cams), "utf-8")
    with pytest.raises(KitError, match="zero or less"):
        read_kit(root)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("inputs", ["cameras.json"]),
        ("sequences", ["a", "b"]),
        ("profile", {"classes": ["rust"]}),
        ("job", "x"),
    ],
)
def test_non_mapping_yaml_sections_are_a_kit_error(tmp_path, key, value):
    root = make_region_kit(tmp_path / "kit")
    raw = yaml.safe_load((root / "job.yaml").read_text("utf-8"))
    raw[key] = value
    (root / "job.yaml").write_text(yaml.safe_dump(raw), "utf-8")
    with pytest.raises(KitError):
        read_kit(root)


def test_non_dict_photo_entry_is_a_kit_error(tmp_path):
    root = make_region_kit(tmp_path / "kit")
    cams = json.loads((root / "cameras.json").read_text("utf-8"))
    cams["photos"][0] = "p01"
    (root / "cameras.json").write_text(json.dumps(cams), "utf-8")
    with pytest.raises(KitError, match="not an entry"):
        read_kit(root)
