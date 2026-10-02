"""Spec validation (spec §6.3): errors block the GLB, warnings don't."""

from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate


def part(pid, **kw):
    base = {
        "id": pid,
        "name": pid,
        "group": "Shell",
        "shape": "cylinder",
        "params": {"id": 4000, "thickness": 8, "height": 3000},
        "source": {"kind": "drawing", "id": "d1"},
    }
    base.update(kw)
    return base


def codes(issues):
    return sorted(i.code for i in issues)


def test_clean_spec_is_ok():
    r = validate(AssetSpec.model_validate({"parts": [part("s1")]}))
    assert r.ok and r.errors == [] and r.warnings == []


def test_duplicate_ids_and_missing_host_are_errors():
    spec = AssetSpec.model_validate(
        {
            "parts": [
                part("s1"),
                part("s1"),
                part(
                    "N1",
                    group="Nozzle",
                    shape="nozzle",
                    params={"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
                    placement={"host": "ghost", "bearing_deg": 0, "elevation_mm": 100},
                ),
            ]
        }
    )
    r = validate(spec)
    assert not r.ok
    assert codes(r.errors) == ["duplicate_id", "host_missing"]


def test_thickness_not_below_radius_is_an_error():
    r = validate(
        AssetSpec.model_validate({"parts": [part("s1", params={"id": 10, "thickness": 6, "height": 10})]})
    )
    assert codes(r.errors) == ["bad_geometry"]


def test_overlap_and_assumed_high_confidence_are_warnings():
    spec = AssetSpec.model_validate(
        {
            "parts": [
                part("s1"),
                part("s2"),
                part(
                    "x",
                    group="Other",
                    shape="box",
                    params={"w": 1, "l": 1, "h": 1},
                    source={"kind": "assumed"},
                    confidence="high",
                    placement={"origin_mm": [9000, 0, 0]},
                ),
            ]
        }
    )
    r = validate(spec)
    assert r.ok
    assert codes(r.warnings) == ["assumed_high_confidence", "overlap"]
