# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]


def test_fixture_is_the_cowork_register(ref):
    assert len(ref) == 885
    assert len(_tagged(ref)) == 404
    assert list(ref[0])[:17] == [
        "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N",
        "base_EL", "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes",
    ]  # fmt: skip
    assert {r["type"] for r in ref} <= set(sc.TYPE_FAMILY)


def test_tags_normalise_case_spaces_and_dashes():
    assert sc.normalise_tag("20-T-0001") == sc.normalise_tag(" 20 – t – 0001 ") == "20T0001"
    assert sc.normalise_tag("70-S-0001A/B") == "70S0001A/B"
    assert sc.normalise_tag(None) == sc.normalise_tag("  ") == ""


def test_type_match_rules():
    assert sc.types_match("pump", "pump")
    assert sc.types_match("package", "pump") and sc.types_match("compressor", "package")
    assert not sc.types_match("package", "building")
    assert sc.types_match("other", "building") and sc.types_match("trestle", "other")
    assert sc.types_match("composite", "tank_lng")
    assert not sc.types_match("fence", "pump")
