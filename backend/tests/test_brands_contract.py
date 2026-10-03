"""The brand contract (spec 2026-10-02-asset-findings §5.8, §8; plan D2 Task 1): the shape U6 and R1
build against, and the three logo operations D2 adds."""

from pathlib import Path

import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"


def _doc() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def test_brand_schema_has_the_spec_columns():
    s = _doc()["components"]["schemas"]
    brand = s["Brand"]
    assert set(brand["required"]) == {
        "id",
        "name",
        "colors",
        "font_text",
        "font_numerals",
        "logo_on_light",
        "logo_on_dark",
        "logo_flat",
        "website",
        "owner",
        "confidentiality",
        "pdf_author",
        "builtin",
        "created_at",
        "updated_at",
    }
    assert set(s["BrandColors"]["required"]) == {"accent", "accent_dark", "navy", "ink", "pale", "line"}
    assert s["BrandLogoSlot"]["enum"] == ["on_light", "on_dark", "flat"]
    assert s["BrandLogoImport"]["required"] == ["path"]


def test_the_logo_operations_exist():
    path = _doc()["paths"]["/api/v1/brands/{brandId}/logos/{slot}"]
    assert path["get"]["operationId"] == "getBrandLogo"
    assert "image/png" in path["get"]["responses"]["200"]["content"]
    assert path["put"]["operationId"] == "setBrandLogo"
    assert path["delete"]["operationId"] == "clearBrandLogo"
    assert {"404", "422", "503"} <= set(path["put"]["responses"])


def test_the_brand_operations_declare_their_refusals():
    paths = _doc()["paths"]
    assert {"409", "422", "503"} <= set(paths["/api/v1/brands"]["post"]["responses"])
    one = paths["/api/v1/brands/{brandId}"]
    assert {"404", "409", "422", "503"} <= set(one["patch"]["responses"])
    assert {"404", "409", "503"} <= set(one["delete"]["responses"])
