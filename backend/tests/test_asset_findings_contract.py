# backend/tests/test_asset_findings_contract.py
"""Asset findings C0: contract/openapi.yaml carries every operation and schema of spec
2026-10-02-asset-findings §8 (plan 2026-10-03-asset-findings-c0).

These tests read only the YAML; `test_contract.py` checks that the backend routes it and
`pnpm -C contract check` lints it. Every operation is listed with the unit that replaces its stub.
"""

from pathlib import Path

import jsonschema_rs
import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "contract" / "openapi.yaml"
SPECTRAL = ROOT / "contract" / ".spectral.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
P = "/api/v1/projects/{projectId}"
AM = P + "/asset-models/{assetModelId}"
F = P + "/findings/{findingId}"
B = "/api/v1/brands"

# operationId -> (method, path, the unit that replaces its 501 stub)
ASSET_FINDINGS_OPERATIONS: dict[str, tuple[str, str, str]] = {
    "getImageReview": ("get", P + "/images/{imageId}/review", "D1"),
    "putImageReview": ("put", P + "/images/{imageId}/review", "D1"),
    "listBrands": ("get", B, "D2"),
    "createBrand": ("post", B, "D2"),
    "patchBrand": ("patch", B + "/{brandId}", "D2"),
    "deleteBrand": ("delete", B + "/{brandId}", "D2"),
    "getBrandLogo": ("get", B + "/{brandId}/logos/{slot}", "D2"),
    "setBrandLogo": ("put", B + "/{brandId}/logos/{slot}", "D2"),
    "clearBrandLogo": ("delete", B + "/{brandId}/logos/{slot}", "D2"),
    "importAssetModelGlb": ("post", AM + "/versions/import-glb", "J1"),
    "listImagePoses": ("get", AM + "/poses", "J2"),
    "estimateImagePoses": ("post", AM + "/poses/estimate", "J2"),
    "putImagePose": ("put", AM + "/poses/{imageId}", "J2"),
    "listPlacements": ("get", AM + "/placements", "J3"),
    "computePlacements": ("post", AM + "/placements/compute", "J3"),
    "getPlacementMesh": ("get", AM + "/placements/{sightingId}/mesh", "J3"),
    "getPlacementTexture": ("get", AM + "/placements/{sightingId}/texture", "J3"),
    "getPlacementLabels": ("get", AM + "/placements/{sightingId}/labels", "J3"),
    "regroupAssetFindings": ("post", AM + "/findings/regroup", "J4"),
    "mergeFinding": ("post", F + "/merge", "J4"),
    "splitFinding": ("post", F + "/split", "J4"),
    "listFindingSightings": ("get", F + "/sightings", "J4"),
    "startReviewImport": ("post", P + "/review-imports", "J5"),
}
NEW_JOB_TYPES = ["asset_glb_import", "asset_pose", "asset_place", "asset_group", "review_kit_import"]
FINDING_ASSET_FIELDS = [
    "asset_model_id",
    "height_m",
    "bearing_deg",
    "side",
    "zone",
    "component",
    "placement",
    "sighting_count",
    "representative",
]
# Response schemas the Prism mock serves for the asset UI: each carries an example that validates.
EXAMPLED = [
    "Finding",
    "FindingDetail",
    "FindingPage",
    "ProjectSearchResult",
    "ImagePoseList",
    "PlacementList",
    "FindingSightingList",
    "ImageReview",
    "Brand",
    "BrandList",
    "ReviewImportPreview",
]
# A generated `next` would be the string "string": a client paging the mock would never stop.
PAGES = ["ImagePoseList", "PlacementList"]
ERROR_CODES = [
    "has_findings",
    "glb_invalid",
    "unknown_profile",
    "invalid_frame",
    "no_origin",
    "invalid_merge",
    "invalid_split",
    "kit_invalid",
    "invalid_import",
    "brand_name_taken",
    "brand_builtin",
    "invalid_brand",
    "unknown_font",
]


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def _schemas(spec: dict) -> dict:
    return spec["components"]["schemas"]


def _params(spec: dict) -> dict:
    return spec["components"]["parameters"]


def _operations(spec: dict) -> dict[str, tuple[str, str, dict]]:
    return {
        op["operationId"]: (method, path, op)
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }


def _param_names(spec: dict, op: dict) -> set[str]:
    names = set()
    for p in op.get("parameters", []):
        names.add(_params(spec)[p["$ref"].rsplit("/", 1)[1]]["name"] if "$ref" in p else p["name"])
    return names


def _param_refs(op: dict) -> list[str]:
    return [p["$ref"] for p in op.get("parameters", []) if "$ref" in p]


def _errors(spec: dict, name: str, instance) -> list[str]:
    validator = jsonschema_rs.Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": spec["components"]}
    )
    return [e.message for e in validator.iter_errors(instance)]


# ------------------------------------------------------------------------------ new operations


@pytest.mark.parametrize("op_id", sorted(ASSET_FINDINGS_OPERATIONS))
def test_the_operation_exists_with_its_tag(spec, op_id):
    ops = _operations(spec)
    assert op_id in ops, op_id
    method, path, op = ops[op_id]
    want_method, want_path, unit = ASSET_FINDINGS_OPERATIONS[op_id]
    assert (method, path) == (want_method, want_path), op_id
    assert op["responses"]["default"] == {"$ref": "#/components/responses/Error"}, op_id
    assert op["tags"] == (["brands"] if unit == "D2" else ["assetreview"]), op_id


def test_the_two_tags_hold_exactly_these_operations(spec):
    tagged = {
        op_id
        for op_id, (_, _, op) in _operations(spec).items()
        if {"assetreview", "brands"} & set(op.get("tags", []))
    }
    assert tagged == set(ASSET_FINDINGS_OPERATIONS)
    assert {"assetreview", "brands"} <= {t["name"] for t in spec["tags"]}


@pytest.mark.parametrize(
    ("op_id", "schema"),
    [
        ("importAssetModelGlb", "AssetModelVersionWithJob"),
        ("estimateImagePoses", "JobRef"),
        ("computePlacements", "JobRef"),
        ("regroupAssetFindings", "JobRef"),
        ("startReviewImport", "JobRef"),
    ],
)
def test_long_work_answers_a_job_and_refuses_a_second_one(spec, op_id, schema):
    responses = _operations(spec)[op_id][2]["responses"]
    assert responses["202"]["content"]["application/json"]["schema"] == {
        "$ref": f"#/components/schemas/{schema}"
    }
    assert "job_running" in responses["409"]["description"], op_id


def test_the_new_job_types_are_documented(spec):
    s = _schemas(spec)
    assert set(NEW_JOB_TYPES) <= set(s["JobType"]["enum"])
    result = s["Job"]["properties"]["result"]["description"]
    for job_type in NEW_JOB_TYPES:
        assert f"{job_type} " in result, job_type


@pytest.mark.parametrize("op_id", ["listImagePoses", "listPlacements"])
def test_the_big_lists_are_keyset_paged_at_2000(spec, op_id):
    refs = _param_refs(_operations(spec)[op_id][2])
    assert "#/components/parameters/assetPageAfter" in refs
    assert "#/components/parameters/assetPageLimit" in refs
    assert _params(spec)["assetPageLimit"]["schema"]["maximum"] == 2000


@pytest.mark.parametrize(
    ("op_id", "media"),
    [
        ("getPlacementMesh", "application/octet-stream"),
        ("getPlacementTexture", "image/png"),
        ("getPlacementLabels", "application/octet-stream"),
    ],
)
def test_a_placement_file_is_binary_with_an_etag(spec, op_id, media):
    responses = _operations(spec)[op_id][2]["responses"]
    assert media in responses["200"]["content"]
    assert "ETag" in responses["200"]["headers"]
    assert "304" in responses


def test_a_brand_logo_is_an_image(spec):
    content = _operations(spec)["getBrandLogo"][2]["responses"]["200"]["content"]
    assert set(content) == {"image/png"}
    assert _schemas(spec)["BrandLogoSlot"]["enum"] == ["on_light", "on_dark", "flat"]
    assert _schemas(spec)["BrandLogoImport"]["required"] == ["path"]


def test_the_review_import_preview_is_a_job_result_spectral_allows(spec):
    assert "ReviewImportPreview" in _schemas(spec)
    assert "openapi.yaml#/components/schemas/ReviewImportPreview" in SPECTRAL.read_text("utf-8")


# ------------------------------------------------------------------------------ existing operations


def test_a_finding_anchor_takes_the_asset_kind(spec):
    s = _schemas(spec)
    assert s["FindingAnchorKind"]["enum"] == ["image", "map", "cloud", "asset"]
    assert (
        s["FindingAnchor"]["discriminator"]["mapping"]["asset"] == "#/components/schemas/FindingAssetAnchor"
    )
    assert (
        s["FindingAnchorInput"]["discriminator"]["mapping"]["asset"]
        == "#/components/schemas/FindingAssetAnchorInput"
    )
    sightings = s["FindingAssetAnchorInput"]["properties"]["sightings"]
    assert (sightings["minItems"], sightings["maxItems"]) == (1, 50)
    assert s["FindingSightingInput"]["required"] == ["image_id", "box"]
    assert s["FindingSightingInput"]["properties"]["box"] == {"$ref": "#/components/schemas/FindingBox"}


def test_a_finding_carries_its_asset_fields(spec):
    finding = _schemas(spec)["Finding"]
    assert set(FINDING_ASSET_FIELDS) <= set(finding["required"])
    assert finding["properties"]["placement"]["enum"] == ["point", "patch", "none", None]
    assert _schemas(spec)["FindingRepresentative"]["required"] == ["image_id", "annotation_id"]


def test_a_sighting_names_its_model_and_may_be_ungrouped(spec):
    sighting = _schemas(spec)["FindingSighting"]
    assert {"asset_model_id", "finding_id"} <= set(sighting["required"])
    assert sighting["properties"]["finding_id"]["type"] == ["string", "null"]
    kinds = _schemas(spec)["Activity"]["properties"]["kind"]["description"]
    for kind in ("finding.merged", "finding.split", "findings.grouped"):
        assert kind in kinds, kind


def test_a_report_config_names_its_brand(spec):
    config = _schemas(spec)["ReportConfig"]
    assert "brand_id" in config["required"]
    assert config["properties"]["brand_id"]["type"] == ["string", "null"]
    assert config["example"]["brand_id"] is None


def test_list_findings_takes_the_asset_filters_and_sorts(spec):
    op = _operations(spec)["listFindings"][2]
    assert {"asset_model_id", "zone", "side", "component", "placed"} <= _param_names(spec, op)
    sort = next(p for p in op["parameters"] if p.get("name") == "sort")
    assert {"-height", "zone"} <= set(sort["schema"]["enum"])


def test_an_asset_model_carries_its_frame_and_review(spec):
    s = _schemas(spec)
    assert {"frame", "review"} <= set(s["AssetModel"]["required"])
    assert {"frame", "review"} <= set(s["AssetModelPatch"]["properties"])
    assert "imported" in s["AssetModelVersion"]["properties"]["kind"]["enum"]
    assert s["AssetProfileId"]["enum"] == ["stack", "building_facade", "tank", "telecom_tower", "ohtl_tower"]
    assert s["AssetReviewConfig"]["additionalProperties"] is False  # P1's block, verbatim
    assert s["AssetReviewZone"]["properties"]["min_m"]["type"] == ["number", "null"]  # open ends are null
    assert s["AssetFrameConversion"]["enum"] == ["none", "x_east_minus_z_north", "enu_z_up"]
    ops = _operations(spec)
    assert "has_findings" in ops["deleteAssetModel"][2]["responses"]["409"]["description"]
    assert "422" in ops["patchAssetModel"][2]["responses"]


def test_the_image_index_filters_by_review_status(spec):
    assert "#/components/parameters/imageReviewStatus" in _param_refs(_operations(spec)["getImageIndex"][2])
    review_status = _params(spec)["imageReviewStatus"]
    assert (review_status["name"], review_status["schema"]["type"]) == ("review_status", "string")
    assert _schemas(spec)["ImageReviewStatus"]["enum"] == ["finding", "none", "uncertain", "not_assessed"]


def test_the_overview_hero_can_be_an_asset_model_and_counts_photo_reviews(spec):
    s = _schemas(spec)
    assert s["OverviewHero"]["properties"]["kind"]["enum"] == [
        "asset_model",
        "map",
        "point_cloud",
        "images",
        "drawing",
    ]
    assert "photo_review" in s["ProjectOverview"]["properties"]
    assert "photo_review" not in s["ProjectOverview"]["required"]
    assert s["PhotoReviewCounts"]["required"] == ["finding", "none", "uncertain", "not_assessed"]


def test_the_error_codes_are_documented(spec):
    text = _schemas(spec)["Error"]["properties"]["error"]["properties"]["code"]["description"]
    for code in ERROR_CODES:
        assert code in text, code


# ------------------------------------------------------------------------------ mock examples


@pytest.mark.parametrize("name", EXAMPLED)
def test_the_mock_example_validates(spec, name):
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    assert _errors(spec, name, example) == [], name
    if name in PAGES:
        assert example["next"] is None, name
