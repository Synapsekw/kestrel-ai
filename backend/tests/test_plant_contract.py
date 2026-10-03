"""Plant model F0: contract/openapi.yaml carries every operation and schema of spec
2026-10-03-plant-model-generator §10, and its plant schemas match the backend's spec models field for
field (plan 2026-10-03-plant-model-f0 Task 9). These tests read only the YAML; test_contract.py checks
the routing and `pnpm -C contract check` lints it.
"""

import typing
from pathlib import Path

import pytest
import yaml

from app.asset_models import spec as S

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "contract" / "openapi.yaml"
P = "/api/v1/projects/{projectId}"
AM = P + "/asset-models/{assetModelId}"

# operationId -> (method, path, the unit that replaces its 501 stub; F0 = live in F0)
PLANT_OPERATIONS: dict[str, tuple[str, str, str]] = {
    "listAssetModelItems": ("get", AM + "/versions/{version}/items", "A1"),
    "getAssetModelItem": ("get", AM + "/versions/{version}/items/{itemId}", "A1"),
    "getAssetModelCsv": ("get", AM + "/versions/{version}/csv", "A1"),
    "listAssetModelRunPackages": ("get", AM + "/runs/{runId}/packages", "R1"),
    "createDrawingPages": ("post", P + "/drawings/pages", "I1"),
    "listUnimportedDrawings": ("get", P + "/drawings/unimported", "I1"),
    "getSiteScene": ("get", P + "/site-scene", "S1"),
    "getAssetModelCatalogue": ("get", "/api/v1/asset-models/catalogue", "F0"),
}
# contract schema -> the backend spec model it mirrors
MIRRORS = {
    "PlantFrame": S.SiteFrame,
    "PlantCrs": S.SiteCrs,
    "PlantDatum": S.Datum,
    "PlantCloudDatum": S.CloudDatum,
    "ItemFootprintRect": S.RectFootprint,
    "ItemFootprintCircle": S.CircleFootprint,
    "ItemFootprintPolygon": S.PolygonFootprint,
    "ItemFootprintLine": S.LineFootprint,
    "ItemFlag": S.ItemFlag,
    "AssetItem": S.Item,
    "EnvFeature": S.EnvFeature,
    "AssetPartSource": S.Source,
    "AssetSpec": S.AssetSpec,
}


@pytest.fixture(scope="module")
def doc() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


@pytest.fixture(scope="module")
def schemas(doc) -> dict:
    return doc["components"]["schemas"]


def test_every_plant_operation_is_in_the_contract(doc):
    found = {
        op["operationId"]: (method, path)
        for path, ops in doc["paths"].items()
        for method, op in ops.items()
        if isinstance(op, dict) and "operationId" in op
    }
    for op_id, (method, path, _unit) in PLANT_OPERATIONS.items():
        assert found.get(op_id) == (method, path), op_id


@pytest.mark.parametrize("name", sorted(MIRRORS))
def test_each_plant_schema_mirrors_its_spec_model(schemas, name):
    model = MIRRORS[name]
    schema = schemas[name]
    assert set(schema["properties"]) == set(model.model_fields), name
    required = {k for k, f in model.model_fields.items() if f.is_required()}
    assert set(schema.get("required", [])) == required, name
    assert schema.get("additionalProperties") is False, name


def test_enums_match_the_spec_literals(schemas):
    assert schemas["ItemFlagCode"]["enum"] == list(typing.get_args(S.FlagCode))
    assert schemas["EnvFeature"]["properties"]["kind"]["enum"] == list(typing.get_args(S.EnvKind))
    assert schemas["AssetItem"]["properties"]["height_source"]["enum"] == list(
        typing.get_args(S.HeightSource)
    )
    kinds = schemas["AssetPartSource"]["properties"]["kind"]["enum"]
    assert kinds == list(typing.get_args(S.Source.model_fields["kind"].annotation))


def test_spec_list_bounds_match(schemas):
    props = schemas["AssetSpec"]["properties"]
    assert props["items"]["maxItems"] == S.MAX_ITEMS
    assert props["environment"]["maxItems"] == S.MAX_ENV
    assert props["parts"]["maxItems"] == S.MAX_PARTS


def test_the_footprint_is_discriminated_by_kind(schemas):
    fp = schemas["ItemFootprint"]
    mapping = fp["discriminator"]["mapping"]
    assert fp["discriminator"]["propertyName"] == "kind"
    assert set(mapping) == {"rect", "circle", "polygon", "line"}
    for kind, ref in mapping.items():
        assert schemas[ref.rsplit("/", 1)[1]]["properties"]["kind"]["enum"] == [kind]


def test_the_map_site_frame_is_untouched(schemas):
    """The plant grid is `PlantFrame`: the map workspace's `SiteFrame` keeps its own shape."""
    assert schemas["SiteFrame"]["required"] == ["kind", "crs_wkt", "epsg", "proj4", "name"]


def test_models_and_runs_gain_their_plant_fields(schemas):
    assert "kind" in schemas["AssetModel"]["required"]
    assert schemas["AssetModelKind"]["enum"] == ["asset", "plant"]
    run = schemas["AssetModelRun"]
    assert run["properties"]["mode"]["enum"] == ["build", "refine", "plant", "plant_package"]
    for field in ("packages", "usage_by_stage"):
        assert field in run["properties"] and field not in run["required"], field
    start = schemas["AssetModelRunStart"]["properties"]
    assert start["mode"]["enum"] == ["build", "refine", "plant", "plant_package"]
    assert {"package_ids", "limits"} <= set(start)
    assert start["sources"]["maxItems"] == 200  # a plant run takes every page
    usage = schemas["AssetModelRunUsageByStage"]
    assert set(usage["required"]) == {"current", "stages", "cost_estimate_usd", "cost_label"}
    assert set(schemas["AssetModelRunStageUsage"]["required"]) == {
        "input_tokens",
        "output_tokens",
        "images",
        "calls",
    }


def test_drawing_intake_schemas_use_the_binding_names(schemas):
    pages = schemas["DrawingPagesCreate"]
    assert set(pages["required"]) == {"inspection_id", "name", "pages", "placement"}
    assert pages["properties"]["pages"]["oneOf"][0]["const"] == "all"
    assert pages["properties"]["pages"]["oneOf"][1]["maxItems"] == 500
    assert set(schemas["DrawingPagesWithJob"]["required"]) == {"drawings", "job"}
    assert set(schemas["UnimportedDrawing"]["required"]) == {"path", "name", "format", "size", "pages"}


def test_every_site_scene_list_is_bounded(schemas):
    props = schemas["SiteScene"]["properties"]
    for name in ("orthos", "clouds", "drawings"):
        assert props[name]["maxItems"] == 200, name
    assert schemas["AssetItemPage"]["properties"]["items"]["maxItems"] == 500
