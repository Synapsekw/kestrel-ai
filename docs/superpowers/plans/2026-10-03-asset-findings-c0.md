# Asset findings C0: contract, 501 stubs, generated client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every operation and schema of spec §8 (and the shapes §5 implies) in `contract/openapi.yaml` before any backend or UI unit builds them, so D1, D2, P1, J1 to J5 and U1 to U6 never edit the contract. Every new operation answers 501 `not_implemented` until its owning unit lands, and every existing operation keeps passing `test_contract.py`.

**Architecture:**
- **Contract first.** New paths are tagged `assetreview` (project scoped) or `brands` (app level). Existing operations gain the asset anchor, filters, sorts and fields. `contract/client/schema.d.ts` is regenerated in the same commit.
- **Stubs.** `backend/app/asset_review/stubs.py` holds one tuple list per owning unit (D1, J1 to J5). `backend/app/brands/stubs.py` holds D2's list. Both go through `app.stubs.add_stubs` and are included in `backend/app/api.py` beside `app.asset_models.runs`. `tests/test_contract.py::EXPECTED_STUBS` reads both lists, so an owner only deletes its own tuples.
- **Kept operations ahead of the backend.** Three operations take request values the backend refuses until their unit lands. They go in `BACKEND_PENDING`: `createFinding` and `listFindings` (J4), `patchAssetModel` (J1).
- **Answers stay conformant.** `FindingOut` and `AssetModelOut` gain the new required fields now, filled for the kinds that exist today. D1 later fills them from its new columns.
- **Client.** `contract/client/index.ts` gains type aliases and four URL builders: three for placements, one for brand logos.
- **Frontend compiles.** C0 adds the five job types to every exhaustive `Record<Job["type"], …>` and switch. It keys `findings/location.ts` by anchor kind and adds the new fields to the typed fixtures.

**Tech Stack:** OpenAPI 3.1, Spectral, openapi-typescript, FastAPI, pydantic, pytest with schemathesis and jsonschema_rs, TypeScript and Vitest.

**Spec sections covered:** §5.1 to §5.6 and §5.8 (API shapes only), §6 (job types and their result shapes), §8 (all operations), §9 (the API needs of the register outcome chips and the Overview asset hero), §11 (the 2,000-row page cap).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** nothing. C0 is batch 1 and runs alone.

**Worktree:** `scripts\start-task.ps1 -Name af-c0`

**Budget:**
- No background job is built here. The contract names the five job types (`asset_glb_import`, `asset_pose`, `asset_place`, `asset_group`, `review_kit_import`), and every long operation answers 202 with a job.
- Bounded reads are fixed in the contract:
  - `listImagePoses` and `listPlacements` are keyset-paged by a plain id (`after`, `next`), at most 2,000 rows a page.
  - `getPlacementMesh`, `getPlacementTexture` and `getPlacementLabels` serve one patch each.
  - `listFindingSightings` caps at 500 rows.
  - `listFindings` keeps its 500-row keyset page.
- Nothing in C0 reads an image or a mesh.

**Execution DAG:**

```
Task 1 (contract YAML + contract tests + regenerate)
   ├──> Task 2 (backend stubs, api.py, test_contract allowances)   ─┐
   ├──> Task 3 (FindingOut / AssetModelOut fields)                 ─┤
   ├──> Task 3b (ReportConfig.brand_id mirror, 0002 pin)           ─┤
   ├──> Task 4 (client aliases + URL builders)                     ─┼──> Task 6 (gate, land)
   └──> Task 5 (frontend compile: job maps, location, fixtures)    ─┘
```

- Independent units: Tasks 2, 3, 3b, 4 and 5. Their files do not overlap, and each needs only Task 1's `openapi.yaml` and `schema.d.ts`.
- Parallel batch: Tasks 2, 3, 3b, 4 and 5, after Task 1.
- Critical path: Task 1, then Task 2, then Task 6. `tests/test_contract.py` is the slowest check, and Task 2 is what makes it pass.

**Review Focus owned here:** none. The index assigns all five Review Focus items to D1, J2, J3, J4, J5, U1 and U2. C0 only fixes the shapes those tests run against. For Focus 4, that is the 409 `has_findings` on `deleteAssetModel`; for Focus 5, it is the 2,000-row page cap.

---

### Task 1: The contract

**Files:**
- Modify: `contract/openapi.yaml`
- Modify: `contract/.spectral.yaml` (one override, `ReviewImportPreview`, the `InspectResult` precedent)
- Regenerate: `contract/client/schema.d.ts`
- Create: `backend/tests/test_asset_findings_contract.py`
- Modify: `backend/tests/test_foundation_contract.py` (the anchor test now expects four kinds)

**Interfaces:**
- Consumes: nothing.
- Produces, over HTTP. Project paths sit under `/api/v1/projects/{projectId}`, written `P`; `AM` is `P/asset-models/{assetModelId}`.

| Method | Path | operationId | Success | Refusals | Owner |
| --- | --- | --- | --- | --- | --- |
| POST | `AM/versions/import-glb` | `importAssetModelGlb` | 202 `AssetModelVersionWithJob` | 409 `job_running`; 422 `glb_invalid` | J1 |
| GET | `AM/poses?sequence&image_id&after&limit` | `listImagePoses` | 200 `ImagePoseList` | | J2 |
| POST | `AM/poses/estimate` | `estimateImagePoses` | 202 `JobRef` | 409 `job_running`; 422 `no_origin` | J2 |
| PUT | `AM/poses/{imageId}` | `putImagePose` | 200 `ImagePose` | | J2 |
| GET | `AM/placements?after&limit` | `listPlacements` | 200 `PlacementList` | | J3 |
| POST | `AM/placements/compute` | `computePlacements` | 202 `JobRef` | 409 `job_running` / `not_ready` | J3 |
| GET | `AM/placements/{sightingId}/mesh` | `getPlacementMesh` | 200 octet-stream, `ETag`; 304 | | J3 |
| GET | `AM/placements/{sightingId}/texture` | `getPlacementTexture` | 200 png, `ETag`; 304 | | J3 |
| GET | `AM/placements/{sightingId}/labels` | `getPlacementLabels` | 200 octet-stream, `ETag`; 304 | | J3 |
| POST | `AM/findings/regroup` | `regroupAssetFindings` | 202 `JobRef` | 409 `job_running` | J4 |
| POST | `P/findings/{findingId}/merge` | `mergeFinding` | 200 `Finding` | 422 `invalid_merge` | J4 |
| POST | `P/findings/{findingId}/split` | `splitFinding` | 201 `Finding` | 422 `invalid_split` | J4 |
| GET | `P/findings/{findingId}/sightings` | `listFindingSightings` | 200 `FindingSightingList` | | J4 |
| GET | `P/images/{imageId}/review` | `getImageReview` | 200 `ImageReview` | | D1 |
| PUT | `P/images/{imageId}/review` | `putImageReview` | 200 `ImageReview` | | D1 |
| POST | `P/review-imports` | `startReviewImport` | 202 `JobRef` | 409 `job_running`; 422 `kit_invalid` / `invalid_import` | J5 |
| GET | `/api/v1/brands` | `listBrands` | 200 `BrandList` | 503 | D2 |
| POST | `/api/v1/brands` | `createBrand` | 201 `Brand` | 409 `brand_name_taken`; 422 `invalid_brand` / `unknown_font`; 503 | D2 |
| PATCH | `/api/v1/brands/{brandId}` | `patchBrand` | 200 `Brand` | 409 `brand_name_taken`; 422 `invalid_brand` / `unknown_font`; 503 | D2 |
| DELETE | `/api/v1/brands/{brandId}` | `deleteBrand` | 204 | 409 `brand_builtin`; 503 | D2 |
| PUT | `/api/v1/brands/{brandId}/logos/{slot}` | `setBrandLogo` | 200 `Brand` | 422 `asset_invalid`; 503 | D2 |
| DELETE | `/api/v1/brands/{brandId}/logos/{slot}` | `clearBrandLogo` | 200 `Brand` | 503 | D2 |
| GET | `/api/v1/brands/{brandId}/logos/{slot}` | `getBrandLogo` | 200 png | | D2 |

- Produces, changes to existing operations and schemas:
  - `createFinding` accepts `anchor.kind = asset` (`FindingAssetAnchorInput`).
  - `listFindings` gains the `asset_model_id`, `zone`, `side`, `component` and `placed` filters, and the `-height` and `zone` sorts. `anchor_kind` (the register's "source") accepts `asset`.
  - `Finding` gains `asset_model_id`, `height_m`, `bearing_deg`, `side`, `zone`, `component`, `placement`, `sighting_count` and `representative`, all required. `FindingAnchorKind` gains `asset`, and `FindingAnchor` gains `FindingAssetAnchor`.
  - `AssetModel` gains `frame` and `review`, both required and nullable. `AssetModelPatch` gains `frame` and `review` (`AssetReviewChoice`: a profile id or an edited copy). `patchAssetModel` declares 422.
  - `AssetModelVersion.kind` gains `imported`.
  - `deleteAssetModel` documents its 409 `has_findings`.
  - `JobType` gains `asset_glb_import`, `asset_pose`, `asset_place`, `asset_group` and `review_kit_import`, and `Job.result` documents each.
  - `getImageIndex` gains `review_status`: a comma-separated list of `finding`, `none`, `uncertain` and `not_assessed`, the shape U4 Task 1 assumes.
  - `OverviewHero.kind` gains `asset_model`, ordered first. `ProjectOverview` gains the optional `photo_review: PhotoReviewCounts | null`. Both are U5 Task 1's shapes.
  - Tags `assetreview` and `brands` are added.
- `ReportConfig.brand_id` (required, nullable), mirrored in `backend/app/reports/schemas.py` by Task 3b.
- Not here (see Index note 1): the other report config additions (`csv_layout`, `SectionKey` `asset_summary`, the `FindingsTableColumn` additions, `FindingPagesOptions.min_severity`). Appendix A gives their exact YAML for R1.

- [ ] **Step 1: Write the failing contract test**

```python
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
    assert responses["202"]["content"]["application/json"]["schema"] == {"$ref": f"#/components/schemas/{schema}"}
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
    assert s["FindingAnchor"]["discriminator"]["mapping"]["asset"] == "#/components/schemas/FindingAssetAnchor"
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
    assert s["OverviewHero"]["properties"]["kind"]["enum"] == ["asset_model", "map", "point_cloud", "images", "drawing"]
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
```

Then update the foundation anchor test. In `backend/tests/test_foundation_contract.py`, replace:

```python
def test_a_finding_anchor_is_one_of_three_kinds(spec):
    anchor = _schemas(spec)["FindingAnchor"]
    assert anchor["discriminator"]["propertyName"] == "kind"
    assert set(anchor["discriminator"]["mapping"]) == {"image", "map", "cloud"}
```

with:

```python
def test_a_finding_anchor_is_one_of_four_kinds(spec):
    anchor = _schemas(spec)["FindingAnchor"]
    assert anchor["discriminator"]["propertyName"] == "kind"
    # asset: spec 2026-10-02-asset-findings §5.5, plan 2026-10-03-asset-findings-c0
    assert set(anchor["discriminator"]["mapping"]) == {"image", "map", "cloud", "asset"}
```

(the two lines after it, about `FindingCloudAnchor`, stay as they are).

- [ ] **Step 2: Run it to verify it fails**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_contract.py tests/test_foundation_contract.py -q`
Expected: FAIL. `test_the_operation_exists_with_its_tag` fails for every new operation (`assert 'getImageReview' in ops`). The anchor, field, filter and example tests fail on missing keys. `test_a_finding_anchor_is_one_of_four_kinds` fails on the mapping set.

- [ ] **Step 3: Tags and the event payload note**

In `contract/openapi.yaml`, replace:

```yaml
  - name: assetmodels
  - name: basemap
```

with:

```yaml
  - name: assetmodels
  - name: assetreview
  - name: brands
  - name: basemap
```

Then replace:

```yaml
    - `asset_models.changed`: `payload` is `{asset_model_ids: [...]}` after an asset model, version or run
      is created, changed or deleted.
```

with:

```yaml
    - `asset_models.changed`: `payload` is `{asset_model_ids: [...]}` after an asset model, version or run
      is created, changed or deleted, and after its poses, placements or grouped findings change
      (asset findings spec 2026-10-02 §6).
```

- [ ] **Step 4: Existing paths**

1. `listFindings`. Replace the `sort` line:

```yaml
        - { name: sort, in: query, required: false, schema: { type: string, enum: ["-severity", number, "-updated_at", type] }, description: "`-severity` when absent" }
```

with:

```yaml
        - { name: asset_model_id, in: query, required: false, schema: { type: string }, description: "only `asset` findings on this asset model" }
        - { name: zone, in: query, required: false, schema: { type: array, maxItems: 200, items: { type: string } }, description: "zone ids of the model's review profile (`AssetReviewZone.id`)" }
        - { name: side, in: query, required: false, schema: { type: array, maxItems: 64, items: { type: string } }, description: "side labels of the model's review profile" }
        - { name: component, in: query, required: false, schema: { type: array, maxItems: 200, items: { type: string } } }
        - { name: placed, in: query, required: false, schema: { type: boolean }, description: "asset findings placed as a point or a patch (true) or not placed (false); other anchor kinds never match" }
        - { name: sort, in: query, required: false, schema: { type: string, enum: ["-severity", number, "-updated_at", type, "-height", zone] }, description: "`-severity` when absent. `-height`: highest first, findings without a height last, then `-number`. `zone`: zone id ascending, findings without a zone last, then `-height`, then `number`" }
```

And replace the `data_id` filter's description, `"the anchor's data item (an images source, a map, an elevation or a point cloud)"`, with `"the anchor's data item (an images source, a map, an elevation, a point cloud or an asset model)"`.

2. `createFinding`. Replace its summary block:

```yaml
      summary: |
        Create a finding. An `image` anchor names an existing annotation (`annotation_id`) or
        carries `box` geometry, which creates the annotation in the same transaction. A map anchor
        should carry `lon`/`lat` (the anchor's WGS84 centroid). `severity` defaults to the type's
        `default_severity`, `status` to `open`. A type of kind `object` answers 422 `not_a_defect`.
```

with:

```yaml
      summary: |
        Create a finding. An `image` anchor names an existing annotation (`annotation_id`) or
        carries `box` geometry, which creates the annotation in the same transaction. A map anchor
        should carry `lon`/`lat` (the anchor's WGS84 centroid). An `asset` anchor carries one or
        more sightings; each creates its annotation (a box, or a polygon from `points`) and a
        `finding_sighting` with `placement` `pending` in the same transaction, and `lon`/`lat`
        default to the asset frame's origin. `severity` defaults to the type's `default_severity`
        (an asset finding: the highest sighting severity when one is given), `status` to `open`.
        A type of kind `object` answers 422 `not_a_defect`.
```

3. `patchAssetModel`. Replace its summary `Rename or retag. Publishes `asset_models.changed`.` with:

```yaml
      summary: |
        Rename or retag, or set the asset frame (`frame`, the whole object) and the review profile
        (`review`: a built-in profile id, resolved against the frame's height, or an edited copy).
        Publishes `asset_models.changed`.
```

Then, in the same operation, insert between its `"404"` line and its `default` line:

```yaml
        "422":
          description: "an unknown profile (`code` is `unknown_profile`) or a frame that breaks a rule the schema cannot state, such as zones that overlap or a level above `height_m` (`code` is `invalid_frame`, details `{errors: [{path, message}]}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
```

4. `deleteAssetModel`. Replace:

```yaml
      summary: Delete the model, its versions, runs and files. Refused while a run or GLB job is live.
      responses:
        "204": { description: deleted }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: a run or GLB job is live (`code` is `job_running`)
```

with:

```yaml
      summary: |
        Delete the model, its versions, runs, poses, placements and files. Refused while a run,
        GLB, import, pose, placement or grouping job is live, and while any finding or ungrouped
        sighting references it.
      responses:
        "204": { description: deleted }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a job of this model is live (`code` is `job_running`), or findings or ungrouped sightings reference it (`code` is `has_findings`, details `{count}`)"
```

5. `getImageIndex` (the shape U4 Task 1 assumes; U4 then skips that task). In its parameters, replace:

```yaml
        - $ref: "#/components/parameters/imageUnlabeled"
        - { name: search, in: query, description: case-insensitive substring of the image path, schema: { type: string } }
```

with:

```yaml
        - $ref: "#/components/parameters/imageUnlabeled"
        - $ref: "#/components/parameters/imageReviewStatus"
        - { name: search, in: query, description: case-insensitive substring of the image path, schema: { type: string } }
```

- [ ] **Step 5: New paths**

Insert this block immediately before the line `  /api/v1/projects/{projectId}/measurements:` (just after the `getAssetModelRunOverlay` path):

```yaml
  # ----- asset findings (spec 2026-10-02-asset-findings §8; plan 2026-10-03-asset-findings-c0)
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/import-glb:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    post:
      tags: [assetreview]
      operationId: importAssetModelGlb
      summary: |
        Import an existing GLB as the model's next version (`kind` `imported`). An
        `asset_glb_import` job copies and hashes the file, reads its node names and extras, checks
        that it loads, converts it to the asset frame once (`frame_conversion`), and fills
        `frame.height_m` and `frame.silhouette` when the model has no frame yet. Publishes
        `asset_models.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/AssetGlbImport" }
      responses:
        "202":
          description: the pending version and its import job
          content:
            application/json:
              schema: { $ref: "#/components/schemas/AssetModelVersionWithJob" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a job of this model is live (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the path is not a readable glTF binary (`code` is `glb_invalid`, details `{reason}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/poses:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    get:
      tags: [assetreview]
      operationId: listImagePoses
      summary: |
        Where each photo was taken from, in this model's asset frame, keyset-paged by image id: the
        cameras layer and split inspection's view from pose. `outcome` is the photo's review status.
      parameters:
        - { name: sequence, in: query, required: false, schema: { type: string, maxLength: 120 }, description: "only poses with this sequence label" }
        - { name: image_id, in: query, required: false, schema: { type: array, maxItems: 100, items: { type: string } }, description: "only these images" }
        - $ref: "#/components/parameters/assetPageAfter"
        - $ref: "#/components/parameters/assetPageLimit"
      responses:
        "200":
          description: one page of poses
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ImagePoseList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/poses/estimate:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    post:
      tags: [assetreview]
      operationId: estimateImagePoses
      summary: |
        Start an `asset_pose` job: a pose for each image in scope from its GPS, altitude and gimbal
        angles (`exif_gimbal`), or aimed at the asset axis when it has no gimbal yaw
        (`exif_axis_aim`). A pose from a kit or set by hand is never overwritten. An image without
        GPS is skipped and listed in the job result.
      requestBody:
        required: false
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ImagePoseEstimate" }
      responses:
        "202":
          description: pose job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a pose job of this model is live (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the model's frame has no geographic origin (`code` is `no_origin`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/poses/{imageId}:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/imageId"
    put:
      tags: [assetreview]
      operationId: putImagePose
      summary: Set one photo's pose by hand (`source` `manual`). Publishes `asset_models.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ImagePoseIn" }
      responses:
        "200":
          description: the stored pose
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ImagePose" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/placements:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    get:
      tags: [assetreview]
      operationId: listPlacements
      summary: |
        The placed sightings (`point` and `patch`) of the model's current version, keyset-paged by
        sighting id. Patch files are fetched one by one, only for visible patches.
      parameters:
        - $ref: "#/components/parameters/assetPageAfter"
        - $ref: "#/components/parameters/assetPageLimit"
      responses:
        "200":
          description: one page of placements
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PlacementList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/placements/compute:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    post:
      tags: [assetreview]
      operationId: computePlacements
      summary: |
        Start an `asset_place` job over every sighting of the model, or only the dirty ones
        (`pending`, or placed on an older version). On success it queues `asset_group` for the same
        model.
      requestBody:
        required: false
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PlacementCompute" }
      responses:
        "202":
          description: placement job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a placement or grouping job of this model is live (`code` is `job_running`), or the model has no ready version (`code` is `not_ready`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/placements/{sightingId}/mesh:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/sightingId"
    get:
      tags: [assetreview]
      operationId: getPlacementMesh
      summary: A patch's triangles.
      responses:
        "200":
          description: "little-endian Float32: n positions (x, y, z in the asset frame, metres), then n uvs (u, v); n is the byte length over 20; every three vertices are one triangle"
          headers:
            ETag:
              description: the placement's version and sighting; send it back as `If-None-Match`
              schema: { type: string }
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
        "304": { description: "`If-None-Match` matched the ETag" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/placements/{sightingId}/texture:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/sightingId"
    get:
      tags: [assetreview]
      operationId: getPlacementTexture
      summary: A patch's texture.
      responses:
        "200":
          description: "the finding polygon filled in its severity colour over the photo crop, with alpha; at most 512 px a side"
          headers:
            ETag:
              description: the placement's version and sighting; send it back as `If-None-Match`
              schema: { type: string }
          content:
            image/png:
              schema: { type: string, format: binary }
        "304": { description: "`If-None-Match` matched the ETag" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/placements/{sightingId}/labels:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
      - $ref: "#/components/parameters/sightingId"
    get:
      tags: [assetreview]
      operationId: getPlacementLabels
      summary: A patch's label grid, for pixel-exact picking.
      responses:
        "200":
          description: "4 bytes (width, then height, each a little-endian uint16), then width times height uint8 labels, row by row from the top left; 1 inside the finding polygon, 0 outside; at most 128 px a side"
          headers:
            ETag:
              description: the placement's version and sighting; send it back as `If-None-Match`
              schema: { type: string }
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
        "304": { description: "`If-None-Match` matched the ETag" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/asset-models/{assetModelId}/findings/regroup:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/assetModelId"
    post:
      tags: [assetreview]
      operationId: regroupAssetFindings
      summary: |
        Start an `asset_group` job. A finding whose sightings are unchanged keeps its number, status,
        note, comments and attachments. A merged-away finding is closed with a comment naming the
        survivor (the lowest number), never deleted. A split creates new findings.
      responses:
        "202":
          description: grouping job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a placement or grouping job of this model is live (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/merge:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    post:
      tags: [assetreview]
      operationId: mergeFinding
      summary: |
        Merge this asset finding into another on the same asset model (`into`). Its sightings move
        to `into`, and it is closed with a comment naming the survivor; its comments and attachments
        stay with it. Answers the survivor. Publishes `findings.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingMerge" }
      responses:
        "200":
          description: the surviving finding
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Finding" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "the merge is not possible (`code` is `invalid_merge`, details `{reason}`: `not_asset`, `other_model` or `same_finding`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/split:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    post:
      tags: [assetreview]
      operationId: splitFinding
      summary: |
        Move the named sightings of this asset finding to a new finding of the same type, with the
        highest severity among them, and answer it. At least one sighting must stay. Publishes
        `findings.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/FindingSplit" }
      responses:
        "201":
          description: the new finding
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Finding" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "the split is not possible (`code` is `invalid_split`, details `{reason}`: `not_asset`, `not_on_finding` or `all_sightings`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/findings/{findingId}/sightings:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/findingId"
    get:
      tags: [assetreview]
      operationId: listFindingSightings
      summary: |
        The finding's sightings, the representative first, then by capture time. An image finding
        answers its one implicit sighting; map and cloud findings answer none.
      responses:
        "200":
          description: the sightings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/FindingSightingList" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/images/{imageId}/review:
    parameters:
      - $ref: "#/components/parameters/projectId"
      - $ref: "#/components/parameters/imageId"
    get:
      tags: [assetreview]
      operationId: getImageReview
      summary: The photo's review status. An image never reviewed answers `not_assessed` with `updated_at` null.
      responses:
        "200":
          description: the review
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ImageReview" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    put:
      tags: [assetreview]
      operationId: putImageReview
      summary: |
        Set the photo's review status. `none` also marks the image empty (`Image.marked_empty`) and
        any other status clears it, in one transaction, so the training data path is unchanged.
        Publishes `images.changed`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ImageReviewPut" }
      responses:
        "200":
          description: the stored review
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ImageReview" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/projects/{projectId}/review-imports:
    parameters:
      - $ref: "#/components/parameters/projectId"
    post:
      tags: [assetreview]
      operationId: startReviewImport
      summary: |
        Start a `review_kit_import` job on a kit job folder (`job.yaml`, `cameras.json`,
        `assessment.json`, `masks/`, optional `merged.json`, `surface.json` and GLB) against an
        image source already imported in the project. With `dry_run` the job writes nothing and its
        result is a `ReviewImportPreview`: the class mapping to confirm and the photo match. A real
        run needs exactly one of `asset_model_id` and `new_model_name`, and a type for every kit
        class.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ReviewImportRequest" }
      responses:
        "202":
          description: import job queued
          content:
            application/json:
              schema: { $ref: "#/components/schemas/JobRef" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "an import into this project is live (`code` is `job_running`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the folder is not a kit job (`code` is `kit_invalid`, details `{missing}`), or the request breaks a rule the schema cannot state (`code` is `invalid_import`, details `{errors: [{path, message}]}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/brands:
    get:
      tags: [brands]
      operationId: listBrands
      summary: Every brand, built-ins first, then by name. Brands live in the catalogue.
      responses:
        "200":
          description: brands
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BrandList" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    post:
      tags: [brands]
      operationId: createBrand
      summary: Create a brand. Fonts are bundled family names.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BrandCreate" }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "409":
          description: "the name is taken after normalising (`code` is `brand_name_taken`, details `{brand_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the name normalises to nothing (`invalid_brand`, details `{errors: [{path, message}]}`) or a font is not bundled (`unknown_font`, details `{path, fonts}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/brands/{brandId}:
    parameters:
      - $ref: "#/components/parameters/brandId"
    patch:
      tags: [brands]
      operationId: patchBrand
      summary: Change a brand. Built-ins are editable; logos go through `setBrandLogo` and `clearBrandLogo`.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BrandPatch" }
      responses:
        "200":
          description: updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "the name is taken after normalising (`code` is `brand_name_taken`, details `{brand_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the name normalises to nothing (`invalid_brand`, details `{errors: [{path, message}]}`) or a font is not bundled (`unknown_font`, details `{path, fonts}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [brands]
      operationId: deleteBrand
      summary: Delete a brand. A report that names it renders with the Kestrel theme.
      responses:
        "204": { description: deleted }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a built-in brand is never deleted (`code` is `brand_builtin`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
  /api/v1/brands/{brandId}/logos/{slot}:
    parameters:
      - $ref: "#/components/parameters/brandId"
      - $ref: "#/components/parameters/brandLogoSlot"
    get:
      tags: [brands]
      operationId: getBrandLogo
      summary: "The brand's logo for this slot as a PNG. Callers add `?v=<logo id>`, so the answer is cached as immutable."
      responses:
        "200":
          description: the logo
          content:
            image/png:
              schema: { type: string, format: binary }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    put:
      tags: [brands]
      operationId: setBrandLogo
      summary: "Import a local PNG, JPEG or WebP (at most 20 MB) as this slot's logo. A copy, at most 1200 px a side, is kept in the app data folder, never in a project."
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BrandLogoImport" }
      responses:
        "200":
          description: the brand with the new logo id
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "the file is missing, too large or not an image (`code` is `asset_invalid`, details `{reason}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [brands]
      operationId: clearBrandLogo
      summary: Remove this slot's logo from the brand. The file stays (another brand may use it).
      responses:
        "200":
          description: the brand without that logo
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
```

- [ ] **Step 6: New parameters**

Insert after the `assetModelRunId` parameter (before `sourceId:`):

```yaml
    sightingId:
      name: sightingId
      in: path
      required: true
      schema: { type: string }
    brandId:
      name: brandId
      in: path
      required: true
      schema: { type: string }
    brandLogoSlot:
      name: slot
      in: path
      required: true
      schema: { $ref: "#/components/schemas/BrandLogoSlot" }
    assetPageAfter:
      name: after
      in: query
      description: "the previous page's `next`: rows after this id (a plain id, never decoded)"
      schema: { type: string, maxLength: 64 }
    assetPageLimit:
      name: limit
      in: query
      description: "at most 2000 rows a page; 500 when absent"
      schema: { type: integer, minimum: 1, maximum: 2000, default: 500 }
    imageReviewStatus:
      name: review_status
      in: query
      description: >-
        comma-separated photo review statuses (asset findings spec §5.4); `not_assessed` also
        matches a photo with no review status yet
      schema:
        type: string
        pattern: "^(finding|none|uncertain|not_assessed)(,(finding|none|uncertain|not_assessed))*$"
```

- [ ] **Step 7: Changes to existing schemas**

1. `Error` code description. After the line ending `type name is empty once normalised; details `{name}`).` insert (same 16-space indent):

```yaml
                Asset findings: has_findings (409: findings still reference the asset model;
                details `{count}`), glb_invalid (422: not a readable glTF binary; details
                `{reason}`), unknown_profile and invalid_frame (422: an asset model patch),
                no_origin (422: pose estimation needs the frame's geographic origin), invalid_merge
                and invalid_split (422: details `{reason}`), kit_invalid (422: the folder is not a
                review kit job; details `{missing}`), invalid_import (422: details
                `{errors: [{path, message}]}`), brand_name_taken (409: a brand with that normalised
                name exists; details `{brand_id}`), brand_builtin (409: a built-in brand is never
                deleted), invalid_brand (422: details `{errors: [{path, message}]}`), unknown_font
                (422: not a bundled font family; details `{path, fonts}`). A brand logo that is not
                a readable image answers asset_invalid.
```

2. `JobType`. Replace `asset_model_glb, asset_model_run]` at the end of its enum with `asset_model_glb, asset_model_run, asset_glb_import, asset_pose, asset_place, asset_group, review_kit_import]`.

3. `Job.result` description. Replace its tail `asset_model_glb {model_id, version}; asset_model_run {run_id, version}"` with:

```
asset_model_glb {model_id, version}; asset_model_run {run_id, version}; asset_glb_import {asset_model_id, version} (params {asset_model_id, version, path, frame_conversion}); asset_pose {asset_model_id, estimated, kept, skipped, skipped_images: [{image_id, reason}] at most 200} (params {asset_model_id, image_ids}); asset_place {asset_model_id, version, point, patch, none, group_job_id} (params {asset_model_id, only_dirty}); asset_group {asset_model_id, created, kept, merged, split} (params {asset_model_id}); review_kit_import {asset_model_id, findings, sightings, statuses, unmatched_count, unmatched: [kit photo names] at most 500}, or a ReviewImportPreview when params.dry_run (params ReviewImportRequest)"
```

4. `FindingAnchorKind`. `enum: [image, map, cloud]` becomes `enum: [image, map, cloud, asset]`.

5. `FindingAnchor`. Add `- $ref: "#/components/schemas/FindingAssetAnchor"` as the fourth `oneOf` entry, and `asset: "#/components/schemas/FindingAssetAnchor"` as the fourth `mapping` entry.

6. `FindingAnchorInput`. Add `- $ref: "#/components/schemas/FindingAssetAnchorInput"` as the fourth `oneOf` entry, and `asset: "#/components/schemas/FindingAssetAnchorInput"` as the fourth `mapping` entry.

7. `Finding`. Replace the `required` line with:

```yaml
      required: [id, number, type_id, severity, status, note, created_by, confidence, anchor, lon, lat, data_type, data_id, created_at, updated_at, reviewed_at, closed_at, asset_model_id, height_m, bearing_deg, side, zone, component, placement, sighting_count, representative]
```

Replace the `data_id` property with:

```yaml
        data_id: { type: string, description: "the anchor's data item: the image's source, the map, the point cloud or the asset model" }
```

After the `closed_at` property (`closed_at: { type: [string, "null"], format: date-time }`), insert:

```yaml
        asset_model_id: { type: [string, "null"], description: "the asset model of an `asset` finding; null for every other kind" }
        height_m: { type: [number, "null"], description: "metres above the asset's ground datum, from the representative sighting; null when it is not placed or not an asset finding" }
        bearing_deg: { type: [number, "null"], minimum: 0, exclusiveMaximum: 360, description: "clockwise from plant north" }
        side: { type: [string, "null"], description: "a side label of the model's review profile" }
        zone: { type: [string, "null"], description: "a zone id of the model's review profile" }
        component: { type: [string, "null"], description: "the GLB part hit, through the profile's component map" }
        placement: { type: [string, "null"], enum: [point, patch, none, null], description: "the representative sighting's placement; null for other anchor kinds" }
        sighting_count: { type: integer, minimum: 0, description: "an asset finding's `finding_sighting` rows; every other kind has one implicit sighting and answers 1" }
        representative:
          description: "the sighting the finding is shown by (an image finding: its own annotation); null for map and cloud findings, or an asset finding with no sighting left"
          oneOf:
            - $ref: "#/components/schemas/FindingRepresentative"
            - type: "null"
```

8. Finding examples. Five example objects gain the nine fields. Make each edit with the surrounding context shown, so each match is unique.

   a. In `Finding.example`, replace:

```yaml
        closed_at: null
    FindingDetail:
```

   with:

```yaml
        closed_at: null
        asset_model_id: null
        height_m: null
        bearing_deg: null
        side: null
        zone: null
        component: null
        placement: null
        sighting_count: 1
        representative: { image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
    FindingDetail:
```

   b. In `FindingDetail.example`, replace:

```yaml
        closed_at: null
        attachment_count: 2
```

   with:

```yaml
        closed_at: null
        asset_model_id: null
        height_m: null
        bearing_deg: null
        side: null
        zone: null
        component: null
        placement: null
        sighting_count: 1
        representative: { image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
        attachment_count: 2
```

   c. In `FindingPage.example`, the first item. Replace:

```yaml
            closed_at: null
          - id: "f0000000-1212-4000-8000-000000000218"
```

   with:

```yaml
            closed_at: null
            asset_model_id: null
            height_m: null
            bearing_deg: null
            side: null
            zone: null
            component: null
            placement: null
            sighting_count: 1
            representative: { image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
          - id: "f0000000-1212-4000-8000-000000000218"
```

   d. In `FindingPage.example`, the second item (a map anchor). Replace:

```yaml
            reviewed_at: "2026-09-26T10:31:00Z"
            closed_at: null
        next_cursor: null
```

   with:

```yaml
            reviewed_at: "2026-09-26T10:31:00Z"
            closed_at: null
            asset_model_id: null
            height_m: null
            bearing_deg: null
            side: null
            zone: null
            component: null
            placement: null
            sighting_count: 1
            representative: null
        next_cursor: null
```

   e. In `ProjectSearchResult.example`. Replace:

```yaml
            closed_at: null
        data:
```

   with:

```yaml
            closed_at: null
            asset_model_id: null
            height_m: null
            bearing_deg: null
            side: null
            zone: null
            component: null
            placement: null
            sighting_count: 1
            representative: { image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-6666-4000-8000-000000000003" }
        data:
```

9. `OverviewHero`. Replace its `description` and `kind`:

```yaml
      description: what the Overview's big pane shows; the first of a ready map, a ready point cloud, the photos, a ready drawing
      required: [kind, id]
      properties:
        kind: { type: string, enum: [map, point_cloud, images, drawing] }
```

with:

```yaml
      description: >-
        what the Overview's big pane shows; the first of a ready asset model with a review profile
        (asset findings spec §9), a ready map, a ready point cloud, the photos, a ready drawing
      required: [kind, id]
      properties:
        kind: { type: string, enum: [asset_model, map, point_cloud, images, drawing] }
```

   Directly after `OverviewHero` (after its `id` property line), add:

```yaml
    PhotoReviewCounts:
      type: object
      description: photos by review status (asset findings spec §5.4); a photo never reviewed is not counted
      required: [finding, none, uncertain, not_assessed]
      properties:
        finding: { type: integer, minimum: 0 }
        none: { type: integer, minimum: 0 }
        uncertain: { type: integer, minimum: 0 }
        not_assessed: { type: integer, minimum: 0 }
```

   In `ProjectOverview.properties`, after `banners`, add the following. It is optional and not in `required`, so today's backend answer and the existing example stay valid:

```yaml
        photo_review:
          description: null until a photo has a review status
          oneOf:
            - $ref: "#/components/schemas/PhotoReviewCounts"
            - type: "null"
```

   These are exactly U5 Task 1 Step 3's shapes; U5 then skips its contract step and keeps only its backend steps.

10. `AssetModel`. Replace the whole schema:

```yaml
    AssetModel:
      type: object
      required: [id, name, asset_type, tag, status, current_version, live_run_id, captured_on, created_at, updated_at, frame, review]
      properties:
        id: { type: string }
        name: { type: string }
        asset_type: { type: [string, "null"] }
        tag: { type: [string, "null"] }
        status: { $ref: "#/components/schemas/AssetModelStatus" }
        current_version: { type: [integer, "null"] }
        live_run_id: { type: [string, "null"] }
        captured_on: { type: [string, "null"], format: date }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
        frame:
          description: "the asset frame (asset findings spec §5.1); null until a GLB import, a kit import or the operator sets it"
          oneOf:
            - $ref: "#/components/schemas/AssetFrame"
            - type: "null"
        review:
          description: "the resolved review profile, a copy stored on the model (asset findings spec §7); null until one is chosen"
          oneOf:
            - $ref: "#/components/schemas/AssetReviewConfig"
            - type: "null"
```

11. `AssetModelPatch`. After its `captured_on` property, insert:

```yaml
        frame:
          description: "the whole frame; null clears it"
          oneOf:
            - $ref: "#/components/schemas/AssetFrame"
            - type: "null"
        review:
          description: "a built-in profile id (resolved against the frame's height) or an edited copy; null clears it"
          oneOf:
            - $ref: "#/components/schemas/AssetReviewChoice"
            - type: "null"
```

12. `AssetModelVersion`. Replace `kind: { type: string, enum: [agent, manual, draft] }` with `kind: { type: string, enum: [agent, manual, draft, imported] }`. Replace its `meta.description` with:

```yaml
          description: "`build_glb` meta: bounds_m, top_m, triangles, parts[{id,name,group,triangles}]; an `imported` version: source_name, sha256, bytes, node_count, frame_conversion, parts[{node,name,group,extras}]"
```

13. `Activity.kind`. Replace its description:

```yaml
        kind: { type: string, description: "`finding.created`, `finding.status`, `finding.severity`, `finding.comment`, `data.imported`, `job.finished` or `detections.accepted`" }
```

with:

```yaml
        kind: { type: string, description: "`finding.created`, `finding.status`, `finding.severity`, `finding.comment`, `finding.merged`, `finding.split`, `findings.grouped`, `data.imported`, `job.finished` or `detections.accepted`" }
```

The three new kinds are J4's: merge, split, and a grouping run (asset findings spec §6.4).

14. `ReportConfig.brand_id` (coordinator ruling; the rest of the report config additions are R1's, see Appendix A). In `ReportConfig`, replace `required: [cover, paper, filters, sections]` with `required: [cover, paper, filters, sections, brand_id]`. After the `sections` property, add the following. Like every report config property it is required and carries no `default` (`test_reports_contract.py`):

```yaml
        brand_id: { type: [string, "null"], maxLength: 64, description: "a `Brand` id; null, or a brand since deleted, prints with the Kestrel theme" }
```

In `ReportConfig.example`, after the `filters` block and before `sections:`, add `brand_id: null` (8-space indent).

- [ ] **Step 8: New schemas**

The frame and review schemas below are P1's YAML, copied verbatim from `2026-10-03-asset-findings-p1.md` Task 6 Step 3, so they match P1's pydantic models. They run from `AssetFrameOrigin` through `AssetReviewConfig`: `AssetFrameOrigin`, `AssetFramePreset`, `AssetFrame`, `AssetReviewZone` (open ends are null), `AssetReviewSides`, `AssetReviewFocus`, `AssetReviewReport`, `AssetReviewComponentRule`, `AssetReviewLimit` and `AssetReviewConfig`. P1 Task 6 then only adds its alignment test. Do not edit them here. If P1's plan changes before C0 runs, copy its current block instead.

Insert after `AssetModelRunWithJob` (before `DrawingPatch:`). The brand schemas at the end of the block are D2 Task 1's end state, copied verbatim, so D2 Task 1 only adds its test:

```yaml
    # ----- asset findings (spec 2026-10-02-asset-findings §5, §8; plan 2026-10-03-asset-findings-c0)
    AssetVec3:
      type: array
      description: "x, y, z in the asset frame: metres, Y up, X plant north, Z plant east"
      items: { type: number }
      minItems: 3
      maxItems: 3
    AssetFrameOrigin:
      type: object
      additionalProperties: false
      description: The asset's base centre (WGS84) and the ground altitude in the photos' altitude datum.
      required: [lat, lon, ground_alt_m]
      properties:
        lat: { type: number, minimum: -90, maximum: 90 }
        lon: { type: number, minimum: -180, maximum: 180 }
        ground_alt_m: { type: number }
    AssetFramePreset:
      type: object
      additionalProperties: false
      description: A named close-up view, in the asset frame (metres).
      required: [id, label, target, camera]
      properties:
        id: { type: string, minLength: 1 }
        label: { type: string, minLength: 1 }
        target: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
        camera: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
    AssetFrame:
      type: object
      additionalProperties: false
      description: >-
        `asset_model.frame` (spec 2026-10-02-asset-findings §5.1). Metres, Y up, X plant north, Z plant
        east, origin at the base centre on the ground datum. `north_offset_deg` is the true bearing of
        plant north; `line_azimuth_deg` is a true bearing. Every field but `height_m` has a default.
      required: [height_m]
      properties:
        origin:
          oneOf:
            - $ref: "#/components/schemas/AssetFrameOrigin"
            - type: "null"
        north_offset_deg: { type: number, default: 0 }
        height_m: { type: number, exclusiveMinimum: 0 }
        datum_label: { type: string, default: Ground }
        datum_note: { type: string, default: "" }
        line_azimuth_deg: { type: [number, "null"] }
        silhouette:
          type: array
          description: "[y, r] pairs, ascending y: the radial outline used by the findings map"
          items: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        levels: { type: array, items: { type: number } }
        presets: { type: array, items: { $ref: "#/components/schemas/AssetFramePreset" } }
    AssetReviewZone:
      type: object
      additionalProperties: false
      required: [id, label, min_m, max_m]
      properties:
        id: { type: string }
        label: { type: string }
        min_m: { type: [number, "null"], description: "null: open below" }
        max_m: { type: [number, "null"], description: "null: open above" }
    AssetReviewSides:
      type: object
      additionalProperties: false
      required: [type, labels, basis, title, noun]
      properties:
        type: { type: string, enum: [compass, faces] }
        labels: { type: array, items: { type: string }, description: "the eight compass points, or the faces in order from the line azimuth" }
        basis: { type: string, enum: [position, normal] }
        title: { type: string }
        noun: { type: string }
    AssetReviewFocus:
      type: object
      additionalProperties: false
      required: [frustum, oblique_deg]
      properties:
        frustum: { type: array, items: { type: number }, minItems: 2, maxItems: 2, description: "half-height of the focus view as [min, max] fractions of the asset height" }
        oblique_deg: { type: number }
    AssetReviewReport:
      type: object
      additionalProperties: false
      required: [pages, min_severity]
      properties:
        pages: { type: string, enum: [finding, defect] }
        min_severity: { type: integer, minimum: 1, maximum: 3 }
    AssetReviewComponentRule:
      type: object
      additionalProperties: false
      required: [match, label]
      properties:
        match: { type: string, description: "a case-insensitive regular expression over the GLB node name" }
        label: { type: string }
    AssetReviewLimit:
      type: object
      additionalProperties: false
      required: [title, text]
      properties:
        title: { type: string }
        text: { type: string }
    AssetReviewConfig:
      type: object
      additionalProperties: false
      description: >-
        `asset_model.review` (spec 2026-10-02-asset-findings §5.1, §7): a review profile resolved for the
        asset's height and editable by the operator. Zones are in metres, top first.
      required:
        - profile_id
        - name
        - asset_noun
        - finding_noun
        - assessment_title
        - finding_unit
        - placement
        - patch_grid
        - cluster_m
        - zones
        - sides
        - focus
        - report
        - component_map
        - facts
        - limits
        - breakdowns
        - footer_disclaimer
      properties:
        profile_id: { type: string, description: "the built-in profile it came from: stack, building_facade, tank, telecom_tower or ohtl_tower" }
        name: { type: string }
        asset_noun: { type: string }
        finding_noun: { type: string }
        assessment_title: { type: string }
        finding_unit: { type: string, enum: [photo, region] }
        placement: { type: string, enum: [patch, point, mixed] }
        patch_grid: { type: integer, minimum: 2, maximum: 128 }
        cluster_m: { type: number, exclusiveMinimum: 0 }
        zones: { type: array, items: { $ref: "#/components/schemas/AssetReviewZone" } }
        sides: { $ref: "#/components/schemas/AssetReviewSides" }
        focus: { $ref: "#/components/schemas/AssetReviewFocus" }
        report: { $ref: "#/components/schemas/AssetReviewReport" }
        component_map: { type: array, items: { $ref: "#/components/schemas/AssetReviewComponentRule" } }
        facts: { type: array, items: { type: string } }
        limits: { type: array, items: { $ref: "#/components/schemas/AssetReviewLimit" } }
        breakdowns: { type: array, items: { type: string } }
        footer_disclaimer: { type: string }
    AssetFrameConversion:
      type: string
      enum: [none, x_east_minus_z_north, enu_z_up]
      description: "how an imported GLB maps to the asset frame: `none` (already X north, Y up, Z east), `x_east_minus_z_north` (Y up, X east, minus Z north: the three.js and kit layout), `enu_z_up` (X east, Y north, Z up: most photogrammetry exports)"
    AssetProfileId:
      type: string
      enum: [stack, building_facade, tank, telecom_tower, ohtl_tower]
    AssetReviewChoice:
      description: "a built-in profile by id, or an edited copy"
      oneOf:
        - type: object
          additionalProperties: false
          required: [profile_id]
          properties:
            profile_id: { $ref: "#/components/schemas/AssetProfileId" }
        - $ref: "#/components/schemas/AssetReviewConfig"
    AssetGlbImport:
      type: object
      additionalProperties: false
      required: [path]
      properties:
        path: { type: string, minLength: 1, maxLength: 1024, description: "an absolute path to a .glb picked with the file dialog" }
        frame_conversion: { $ref: "#/components/schemas/AssetFrameConversion" }
        origin:
          description: "sets `frame.origin` when the model has no frame yet"
          oneOf:
            - $ref: "#/components/schemas/AssetFrameOrigin"
            - type: "null"
        note: { type: [string, "null"], maxLength: 500 }
    ImagePoseSource:
      type: string
      enum: [kit, exif_gimbal, exif_axis_aim, manual]
    ImageReviewStatus:
      type: string
      enum: [finding, none, uncertain, not_assessed]
    ImagePose:
      type: object
      required: [image_id, position, target, up, hfov_deg, vfov_deg, source, accuracy_m, sequence, outcome, updated_at]
      properties:
        image_id: { type: string }
        position: { $ref: "#/components/schemas/AssetVec3" }
        target: { $ref: "#/components/schemas/AssetVec3" }
        up: { $ref: "#/components/schemas/AssetVec3" }
        hfov_deg: { type: number, exclusiveMinimum: 0, maximum: 180 }
        vfov_deg: { type: number, exclusiveMinimum: 0, maximum: 180 }
        source: { $ref: "#/components/schemas/ImagePoseSource" }
        accuracy_m: { type: [number, "null"], minimum: 0, description: "the stated accuracy, shown in the UI" }
        sequence: { type: [string, "null"], description: "a flight or sequence label for filters and colours" }
        outcome: { $ref: "#/components/schemas/ImageReviewStatus" }
        updated_at: { type: string, format: date-time }
    ImagePoseList:
      type: object
      required: [items, next]
      properties:
        items: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/ImagePose" } }
        next: { type: [string, "null"], description: "pass as `after` for the next page; null on the last" }
      example:
        items:
          - image_id: "10000000-5555-4000-8000-000000000001"
            position: [42.0, 31.5, -18.2]
            target: [0.0, 30.0, 0.0]
            up: [0.0, 1.0, 0.0]
            hfov_deg: 69.7
            vfov_deg: 55.8
            source: exif_gimbal
            accuracy_m: 2.5
            sequence: "Flight 1"
            outcome: finding
            updated_at: "2026-10-03T09:00:00Z"
        next: null
    ImagePoseIn:
      type: object
      additionalProperties: false
      required: [position, target, up, hfov_deg, vfov_deg]
      properties:
        position: { $ref: "#/components/schemas/AssetVec3" }
        target: { $ref: "#/components/schemas/AssetVec3" }
        up: { $ref: "#/components/schemas/AssetVec3" }
        hfov_deg: { type: number, exclusiveMinimum: 0, maximum: 180 }
        vfov_deg: { type: number, exclusiveMinimum: 0, maximum: 180 }
        accuracy_m: { type: [number, "null"], minimum: 0 }
        sequence: { type: [string, "null"], maxLength: 120 }
    ImagePoseEstimate:
      type: object
      additionalProperties: false
      properties:
        image_ids: { type: array, minItems: 1, maxItems: 100000, items: { type: string }, description: "absent: every image of the project with GPS" }
    ImageReview:
      type: object
      required: [image_id, status, note, coverage, uncertain_coverage, updated_at]
      properties:
        image_id: { type: string }
        status: { $ref: "#/components/schemas/ImageReviewStatus" }
        note: { type: string }
        coverage: { type: [number, "null"], minimum: 0, maximum: 1, description: "share of the photo inside finding polygons (computed)" }
        uncertain_coverage: { type: [number, "null"], minimum: 0, maximum: 1 }
        updated_at: { type: [string, "null"], format: date-time, description: "null: never reviewed" }
      example: { image_id: "10000000-5555-4000-8000-000000000001", status: uncertain, note: "Glare on the lower shell.", coverage: null, uncertain_coverage: 0.04, updated_at: "2026-10-03T09:00:00Z" }
    ImageReviewPut:
      type: object
      additionalProperties: false
      required: [status]
      properties:
        status: { $ref: "#/components/schemas/ImageReviewStatus" }
        note: { type: string, maxLength: 4000, description: "empty when absent" }
    Placement:
      type: object
      required: [sighting_id, finding_id, kind, center, normal, size, severity, type_id, has_patch]
      properties:
        sighting_id: { type: string }
        finding_id: { type: string }
        kind: { type: string, enum: [point, patch] }
        center: { $ref: "#/components/schemas/AssetVec3" }
        normal: { $ref: "#/components/schemas/AssetVec3" }
        size: { type: number, minimum: 0, description: "a patch's longest bounding edge (m); 0 for a point" }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "the sighting's grade, else its finding's" }
        type_id: { type: string }
        has_patch: { type: boolean, description: "true for a patch: its mesh, texture and labels can be fetched" }
    PlacementList:
      type: object
      required: [version, items, next]
      properties:
        version: { type: [integer, "null"], description: "the model version the placements were computed on; null when the model has none" }
        items: { type: array, maxItems: 2000, items: { $ref: "#/components/schemas/Placement" } }
        next: { type: [string, "null"], description: "pass as `after` for the next page; null on the last" }
      example:
        version: 2
        items:
          - { sighting_id: "s0000000-8888-4000-8000-000000000001", finding_id: "f0000000-1212-4000-8000-000000000217", kind: patch, center: [1.2, 61.4, -9.8], normal: [0.12, 0.0, -0.99], size: 0.84, severity: 2, type_id: "c1a2b3c4-0000-4000-8000-000000000009", has_patch: true }
          - { sighting_id: "s0000000-8888-4000-8000-000000000002", finding_id: "f0000000-1212-4000-8000-000000000218", kind: point, center: [-3.1, 12.0, 4.4], normal: [-0.6, 0.0, 0.8], size: 0, severity: 1, type_id: "c1a2b3c4-0000-4000-8000-000000000009", has_patch: false }
        next: null
    PlacementCompute:
      type: object
      additionalProperties: false
      properties:
        only_dirty: { type: boolean, description: "true: only `pending` sightings and those placed on an older version; absent or false: every sighting" }
    FindingRepresentative:
      type: object
      required: [image_id, annotation_id]
      properties:
        image_id: { type: string }
        annotation_id: { type: string }
    FindingAssetAnchor:
      type: object
      required: [kind, asset_model_id, asset_version, point, normal]
      properties:
        kind: { type: string, enum: [asset] }
        asset_model_id: { type: string }
        asset_version: { type: [integer, "null"], description: "the model version the placement was computed on" }
        point: { type: [array, "null"], items: { type: number }, minItems: 3, maxItems: 3, description: "the representative sighting's hit point (asset frame, m); null when unplaced" }
        normal: { type: [array, "null"], items: { type: number }, minItems: 3, maxItems: 3 }
      example: { kind: asset, asset_model_id: "m0000000-9999-4000-8000-000000000001", asset_version: 2, point: [1.2, 61.4, -9.8], normal: [0.12, 0.0, -0.99] }
    FindingSightingInput:
      type: object
      additionalProperties: false
      required: [image_id, box]
      properties:
        image_id: { type: string }
        box: { $ref: "#/components/schemas/FindingBox" }
        points:
          type: array
          minItems: 3
          maxItems: 4096
          description: "the polygon in image pixels; the annotation is then a polygon whose box is `box`"
          items: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "the sighting's own grade" }
        group_tag: { type: [string, "null"], maxLength: 80, description: "sightings with the same tag always group together" }
    FindingAssetAnchorInput:
      type: object
      additionalProperties: false
      required: [kind, asset_model_id, sightings]
      properties:
        kind: { type: string, enum: [asset] }
        asset_model_id: { type: string }
        sightings: { type: array, minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/FindingSightingInput" } }
      example: { kind: asset, asset_model_id: "m0000000-9999-4000-8000-000000000001", sightings: [{ image_id: "10000000-5555-4000-8000-000000000001", box: { x: 812, y: 404, w: 96, h: 40 } }] }
    FindingSightingPlacement:
      type: string
      enum: [point, patch, none, pending]
    FindingSighting:
      type: object
      required: [id, asset_model_id, finding_id, image_id, annotation_id, image_name, captured_at, severity, group_tag, placement, center, normal, part, coverage, placed_version, stale, height_m, bearing_deg, side, zone, created_at]
      properties:
        id: { type: string, description: "the sighting id; an image finding's implicit sighting answers its annotation id" }
        asset_model_id: { type: string, description: "the asset model the sighting belongs to; an image finding's implicit sighting answers an empty string" }
        finding_id: { type: [string, "null"], description: "null for a sighting not grouped into a finding yet (before `asset_group` runs)" }
        image_id: { type: string }
        annotation_id: { type: string, description: "the box, rbox, polygon or point (`Box.id`) that is the sighting's geometry" }
        image_name: { type: string, description: "the photo's file name" }
        captured_at: { type: [string, "null"], format: date-time }
        severity: { type: [integer, "null"], minimum: 1, maximum: 9 }
        group_tag: { type: [string, "null"] }
        placement: { $ref: "#/components/schemas/FindingSightingPlacement" }
        center: { type: [array, "null"], items: { type: number }, minItems: 3, maxItems: 3, description: "the hit point (asset frame, m); null unless placed" }
        normal: { type: [array, "null"], items: { type: number }, minItems: 3, maxItems: 3 }
        part: { type: [string, "null"], description: "the GLB node hit, through the profile's component map" }
        coverage: { type: [number, "null"], minimum: 0, maximum: 1, description: "polygon area over the photo area" }
        placed_version: { type: [integer, "null"] }
        stale: { type: boolean, description: "placed on an older version than the model's current one" }
        height_m: { type: [number, "null"], description: "derived from `center` on read; null when unplaced" }
        bearing_deg: { type: [number, "null"], minimum: 0, exclusiveMaximum: 360 }
        side: { type: [string, "null"] }
        zone: { type: [string, "null"] }
        created_at: { type: string, format: date-time }
    FindingSightingList:
      type: object
      required: [items]
      properties:
        items: { type: array, maxItems: 500, items: { $ref: "#/components/schemas/FindingSighting" } }
      example:
        items:
          - id: "s0000000-8888-4000-8000-000000000001"
            asset_model_id: "m0000000-9999-4000-8000-000000000001"
            finding_id: "f0000000-1212-4000-8000-000000000217"
            image_id: "10000000-5555-4000-8000-000000000001"
            annotation_id: "b0000000-6666-4000-8000-000000000003"
            image_name: "DJI_0412.JPG"
            captured_at: "2026-09-14T09:12:00Z"
            severity: 2
            group_tag: null
            placement: patch
            center: [1.2, 61.4, -9.8]
            normal: [0.12, 0.0, -0.99]
            part: "Shaft"
            coverage: 0.012
            placed_version: 2
            stale: false
            height_m: 61.4
            bearing_deg: 277.0
            side: "W"
            zone: "shaft"
            created_at: "2026-10-03T09:00:00Z"
    FindingMerge:
      type: object
      additionalProperties: false
      required: [into]
      properties:
        into: { type: string, description: "the finding that survives" }
    FindingSplit:
      type: object
      additionalProperties: false
      required: [sighting_ids]
      properties:
        sighting_ids: { type: array, minItems: 1, maxItems: 500, uniqueItems: true, items: { type: string } }
    ReviewImportRequest:
      type: object
      additionalProperties: false
      required: [folder, image_source_id, dry_run]
      properties:
        folder: { type: string, minLength: 1, maxLength: 1024, description: "an absolute path to the kit job folder" }
        image_source_id: { type: string, description: "the image source holding the kit's photos" }
        asset_model_id: { type: [string, "null"], description: "fill this model; or give `new_model_name`" }
        new_model_name: { type: [string, "null"], minLength: 1, maxLength: 120 }
        class_map: { type: object, maxProperties: 200, additionalProperties: { type: string }, description: "kit class key to catalogue type id, as confirmed after the dry run" }
        dry_run: { type: boolean }
    ReviewImportClass:
      type: object
      required: [key, label, count, type_id]
      properties:
        key: { type: string }
        label: { type: string }
        count: { type: integer, minimum: 0 }
        type_id: { type: [string, "null"], description: "from `class_map`, else the catalogue type with the same normalised name, else null" }
    ReviewImportPreview:
      type: object
      description: "the `result` of a `review_kit_import` dry run (read through `GET /projects/{projectId}/jobs/{jobId}`)"
      required: [unit, profile, profile_id, photos, matched, unmatched_count, unmatched, classes, statuses, has_surface, has_glb, has_merged]
      properties:
        unit: { type: string, enum: [region, photo] }
        profile: { type: string, description: "the profile name in job.yaml" }
        profile_id:
          description: "the built-in it maps to; null when Kestrel has no such profile (a real run refuses with `kit_invalid`)"
          oneOf:
            - $ref: "#/components/schemas/AssetProfileId"
            - type: "null"
        photos: { type: integer, minimum: 0 }
        matched: { type: integer, minimum: 0 }
        unmatched_count: { type: integer, minimum: 0 }
        unmatched: { type: array, maxItems: 500, items: { type: string }, description: "kit photo names with no project image" }
        classes: { type: array, maxItems: 200, items: { $ref: "#/components/schemas/ReviewImportClass" } }
        statuses:
          type: object
          required: [finding, none, uncertain, not_assessed]
          properties:
            finding: { type: integer, minimum: 0 }
            none: { type: integer, minimum: 0 }
            uncertain: { type: integer, minimum: 0 }
            not_assessed: { type: integer, minimum: 0 }
        has_surface: { type: boolean, description: "surface.json is present: placements replay" }
        has_glb: { type: boolean }
        has_merged: { type: boolean, description: "merged.json is present: region polygons" }
      example:
        unit: region
        profile: building_facade
        profile_id: building_facade
        photos: 3
        matched: 2
        unmatched_count: 1
        unmatched: ["DJI_0099.JPG"]
        classes: [{ key: crack, label: "Crack", count: 4, type_id: "c1a2b3c4-0000-4000-8000-000000000009" }]
        statuses: { finding: 2, none: 0, uncertain: 1, not_assessed: 0 }
        has_surface: false
        has_glb: true
        has_merged: true
    BrandColors:
      type: object
      additionalProperties: false
      required: [accent, accent_dark, navy, ink, pale, line]
      description: Hex colours (`#RRGGBB`). Stored upper case.
      properties:
        accent: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        accent_dark: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        navy: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        ink: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        pale: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        line: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
    Brand:
      type: object
      required: [id, name, colors, font_text, font_numerals, logo_on_light, logo_on_dark, logo_flat, website, owner, confidentiality, pdf_author, builtin, created_at, updated_at]
      properties:
        id: { type: string }
        name: { type: string }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text:
          type: [string, "null"]
          description: A bundled font family (`Nunito Sans`, `Poppins`, `Inter`); null prints in the report theme's font.
        font_numerals:
          type: [string, "null"]
          description: The family for numbers and headings; null falls back to `font_text`.
        logo_on_light: { type: [string, "null"], description: "A brand logo id (`logo-<16 hex>`); read it with getBrandLogo." }
        logo_on_dark: { type: [string, "null"] }
        logo_flat: { type: [string, "null"] }
        website: { type: string }
        owner: { type: string }
        confidentiality:
          type: string
          description: The footer line. `{year}` and `{customer}` are filled in when the report renders.
        pdf_author: { type: string }
        builtin: { type: boolean, description: Seeded by the app; editable, never deleted. }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
      example:
        id: "builtin-white-label"
        name: "White label"
        colors: { accent: "#2F6FED", accent_dark: "#1E4FB8", navy: "#1B2A41", ink: "#1F2328", pale: "#F4F6F8", line: "#D0D7DE" }
        font_text: Inter
        font_numerals: Inter
        logo_on_light: null
        logo_on_dark: null
        logo_flat: null
        website: ""
        owner: ""
        confidentiality: "Confidential. Prepared for {customer}, {year}."
        pdf_author: ""
        builtin: true
        created_at: "2026-10-03T00:00:00Z"
        updated_at: "2026-10-03T00:00:00Z"
    BrandList:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Brand" } }
      example:
        items:
          - id: "builtin-white-label"
            name: "White label"
            colors: { accent: "#2F6FED", accent_dark: "#1E4FB8", navy: "#1B2A41", ink: "#1F2328", pale: "#F4F6F8", line: "#D0D7DE" }
            font_text: Inter
            font_numerals: Inter
            logo_on_light: null
            logo_on_dark: null
            logo_flat: null
            website: ""
            owner: ""
            confidentiality: "Confidential. Prepared for {customer}, {year}."
            pdf_author: ""
            builtin: true
            created_at: "2026-10-03T00:00:00Z"
            updated_at: "2026-10-03T00:00:00Z"
    BrandCreate:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name: { type: string, minLength: 1, maxLength: 80 }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text: { type: [string, "null"], maxLength: 80 }
        font_numerals: { type: [string, "null"], maxLength: 80 }
        website: { type: string, maxLength: 200 }
        owner: { type: string, maxLength: 120 }
        confidentiality: { type: string, maxLength: 1000 }
        pdf_author: { type: string, maxLength: 120 }
    BrandPatch:
      type: object
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 80 }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text: { type: [string, "null"], maxLength: 80 }
        font_numerals: { type: [string, "null"], maxLength: 80 }
        website: { type: string, maxLength: 200 }
        owner: { type: string, maxLength: 120 }
        confidentiality: { type: string, maxLength: 1000 }
        pdf_author: { type: string, maxLength: 120 }
    BrandLogoSlot:
      type: string
      enum: [on_light, on_dark, flat]
      description: "`on_light` for white bars, `on_dark` for the cover band, `flat` (no alpha) for the PDF running header."
    BrandLogoImport:
      type: object
      additionalProperties: false
      required: [path]
      properties:
        path: { type: string, minLength: 1, maxLength: 1024, description: An absolute path to a PNG, JPEG or WebP of at most 20 MB. }
```

Then add one override at the end of `contract/.spectral.yaml`:

```yaml
  - files: ["openapi.yaml#/components/schemas/ReviewImportPreview"]
    rules:
      oas3-unused-component: off
```

- [ ] **Step 9: Run the contract tests to verify they pass**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_contract.py tests/test_foundation_contract.py tests/test_reports_contract.py tests/test_images_contract.py tests/test_workspace_contract.py tests/test_cloud_workspace_contract.py tests/test_setup_contract.py -q`
Expected: PASS. If `test_the_mock_example_validates[...]` lists an error, fix the example rather than the schema, unless the schema contradicts §5.

- [ ] **Step 10: Lint and regenerate**

Run: `pnpm -C contract lint`
Expected: 0 errors. If `oas3-unused-component` names a schema, it is not referenced: fix the `$ref`. Only `ReviewImportPreview` has an override.

Run: `pnpm -C contract generate`
Expected: `contract/client/schema.d.ts` rewritten, with `FindingAssetAnchor`, `ImagePose`, `Placement` and `Brand` in it.

- [ ] **Step 11: Commit**

```bash
git add contract/openapi.yaml contract/.spectral.yaml contract/client/schema.d.ts backend/tests/test_asset_findings_contract.py backend/tests/test_foundation_contract.py
git commit -m "feat(contract): asset findings operations and schemas (af-c0)

Every operation of spec 2026-10-02-asset-findings section 8, the asset anchor, the finding and
asset model fields, five job types, the brands API and ReportConfig.brand_id. The other
report config additions are R1's (plan af-c0 Index note 1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The frontend build and `test_contract.py` are red until Tasks 2 to 5 land. That is expected on the task branch; Task 6 gates the whole unit.

---

### Task 2: 501 stubs and the contract test allowances

**Files:**
- Create: `backend/app/asset_review/__init__.py`
- Create: `backend/app/asset_review/stubs.py`
- Create: `backend/app/brands/__init__.py`
- Create: `backend/app/brands/stubs.py`
- Modify: `backend/app/api.py` (two module names in the guarded tuple after `"app.asset_models.runs"`)
- Modify: `backend/tests/test_contract.py` (`EXPECTED_STUBS`, `BACKEND_PENDING`)
- Create: `backend/tests/test_asset_findings_stubs.py`

**Interfaces:**
- Consumes: `app.stubs.add_stubs(router, stubs, project_scoped=True)`; `ASSET_FINDINGS_OPERATIONS` from Task 1's test module.
- Produces:
  - `app.asset_review.stubs`: `D1_STUBS`, `J1_STUBS`, `J2_STUBS`, `J3_STUBS`, `J4_STUBS`, `J5_STUBS: list[tuple[str, str, str]]` (method, path relative to `/projects/{projectId}`, operationId); `STUBS`; `router`; `stub_operation_ids() -> set[str]`.
  - `app.brands.stubs`: `D2_STUBS` (paths relative to `/api/v1`), `STUBS`, `router`, `stub_operation_ids() -> set[str]`.
  - `BACKEND_PENDING` entries: `createFinding: "J4"`, `listFindings: "J4"`, `patchAssetModel: "J1"`.
- How an owner lands: it deletes its tuples from the list here and routes the real handler. It inserts its own router module in `app/api.py` above `"app.asset_review.stubs"` (D2: above `"app.brands.stubs"`). It also deletes its `BACKEND_PENDING` line, if it has one. The last of D1 and J1 to J5 to land deletes `app/asset_review/stubs.py`, its line in `app/api.py`, and its `EXPECTED_STUBS |=` line and import. D2 does the same for `app/brands/stubs.py`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_findings_stubs.py
"""Asset findings C0: every new operation is routed as a 501 stub until its unit lands (plan
2026-10-03-asset-findings-c0). A unit that builds an operation deletes its tuple from
app/asset_review/stubs.py or app/brands/stubs.py, and these tests follow because they read the lists.
"""

import re

from test_asset_findings_contract import ASSET_FINDINGS_OPERATIONS
from test_contract import EXPECTED_STUBS

from app.asset_review import stubs as review_stubs
from app.brands import stubs as brand_stubs

PROJECT = "/api/v1/projects/{projectId}"
APP = "/api/v1"
UNIT_LISTS = {
    "D1": (review_stubs.D1_STUBS, PROJECT),
    "J1": (review_stubs.J1_STUBS, PROJECT),
    "J2": (review_stubs.J2_STUBS, PROJECT),
    "J3": (review_stubs.J3_STUBS, PROJECT),
    "J4": (review_stubs.J4_STUBS, PROJECT),
    "J5": (review_stubs.J5_STUBS, PROJECT),
    "D2": (brand_stubs.D2_STUBS, APP),
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _kwargs(method: str) -> dict:
    return {"json": {}} if method in ("POST", "PUT", "PATCH") else {}


def test_every_stub_is_an_asset_findings_operation_the_contract_test_expects():
    ids = review_stubs.stub_operation_ids() | brand_stubs.stub_operation_ids()
    assert ids <= set(ASSET_FINDINGS_OPERATIONS), sorted(ids - set(ASSET_FINDINGS_OPERATIONS))
    assert ids <= EXPECTED_STUBS, sorted(ids - EXPECTED_STUBS)


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, (listed, prefix) in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert ASSET_FINDINGS_OPERATIONS[op_id] == (method.lower(), prefix + path, unit), op_id


def test_the_lists_add_up():
    assert review_stubs.STUBS == [
        *review_stubs.D1_STUBS,
        *review_stubs.J1_STUBS,
        *review_stubs.J2_STUBS,
        *review_stubs.J3_STUBS,
        *review_stubs.J4_STUBS,
        *review_stubs.J5_STUBS,
    ]
    assert brand_stubs.STUBS == brand_stubs.D2_STUBS


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in review_stubs.STUBS:
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in review_stubs.STUBS:
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 404, (op_id, r.text)


def test_the_brand_stubs_answer_501(client):
    for method, path, op_id in brand_stubs.STUBS:
        r = client.request(method, f"{APP}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_stubs.py -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.asset_review'`.

- [ ] **Step 3: Implement the stub modules**

```python
# backend/app/asset_review/__init__.py
"""Findings on the asset (spec 2026-10-02-asset-findings): review profiles, the asset frame, poses,
placement, grouping and the kit import. One module per concern; see the plan index
docs/superpowers/plans/2026-10-03-asset-findings.md."""
```

```python
# backend/app/asset_review/stubs.py
"""501 placeholders for the asset-findings operations (spec 2026-10-02-asset-findings §8, plan
2026-10-03-asset-findings-c0).

C0 lands the whole contract before any unit builds it, so every new project-scoped operation is
routed here and answers 501 `not_implemented` until its unit lands (ADR
2026-09-26-foundation-contract-lands-before-its-backend). Each list belongs to one unit of the
index's DAG. A unit that builds an operation deletes its tuple here and routes the real handler in
its own module, which it inserts in `app/api.py` above "app.asset_review.stubs";
`tests/test_contract.py::EXPECTED_STUBS` is derived from `stub_operation_ids()`, so nothing else
needs editing. The last of D1 and J1 to J5 to land deletes this module, its line in `app/api.py`,
and the `EXPECTED_STUBS |=` line with its import.

Paths are relative to `/projects/{projectId}` and resolve the project first (404 for an unknown
project). Path-parameter names are the contract's: `test_every_spec_path_is_routed` compares path
strings.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

# (method, path, operationId)
Stub = tuple[str, str, str]

M = "/asset-models/{assetModelId}"

# D1: the photo review status (spec §5.4).
D1_STUBS: list[Stub] = [
    ("GET", "/images/{imageId}/review", "getImageReview"),
    ("PUT", "/images/{imageId}/review", "putImageReview"),
]

# J1: GLB import (spec §6.1).
J1_STUBS: list[Stub] = [
    ("POST", M + "/versions/import-glb", "importAssetModelGlb"),
]

# J2: photo poses (spec §6.2).
J2_STUBS: list[Stub] = [
    ("GET", M + "/poses", "listImagePoses"),
    ("POST", M + "/poses/estimate", "estimateImagePoses"),
    ("PUT", M + "/poses/{imageId}", "putImagePose"),
]

# J3: placement and its files (spec §6.3, §5.7).
J3_STUBS: list[Stub] = [
    ("GET", M + "/placements", "listPlacements"),
    ("POST", M + "/placements/compute", "computePlacements"),
    ("GET", M + "/placements/{sightingId}/mesh", "getPlacementMesh"),
    ("GET", M + "/placements/{sightingId}/texture", "getPlacementTexture"),
    ("GET", M + "/placements/{sightingId}/labels", "getPlacementLabels"),
]

# J4: grouping, merge, split and sightings (spec §6.4).
J4_STUBS: list[Stub] = [
    ("POST", M + "/findings/regroup", "regroupAssetFindings"),
    ("POST", "/findings/{findingId}/merge", "mergeFinding"),
    ("POST", "/findings/{findingId}/split", "splitFinding"),
    ("GET", "/findings/{findingId}/sightings", "listFindingSightings"),
]

# J5: the kit import (spec §6.5).
J5_STUBS: list[Stub] = [
    ("POST", "/review-imports", "startReviewImport"),
]

STUBS: list[Stub] = [*D1_STUBS, *J1_STUBS, *J2_STUBS, *J3_STUBS, *J4_STUBS, *J5_STUBS]

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])
add_stubs(router, STUBS)


def stub_operation_ids() -> set[str]:
    """Every project-scoped asset-findings operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in STUBS}
```

```python
# backend/app/brands/__init__.py
"""Report brands (spec 2026-10-02-asset-findings §5.8): rows in catalogue.db, the brands API, and
the brand overlay on the report theme (unit D2)."""
```

```python
# backend/app/brands/stubs.py
"""501 placeholders for the brands API (spec 2026-10-02-asset-findings §5.8, §8; plan
2026-10-03-asset-findings-c0) until D2 lands.

Brands are app-wide, not per project: paths are relative to `/api/v1`. D2 deletes its tuples (all
of them), this module, its line in `app/api.py`, and the `EXPECTED_STUBS |=` line with its import in
`tests/test_contract.py`.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

Stub = tuple[str, str, str]

B = "/brands"

# D2: the brands catalogue and its logos.
D2_STUBS: list[Stub] = [
    ("GET", B, "listBrands"),
    ("POST", B, "createBrand"),
    ("PATCH", B + "/{brandId}", "patchBrand"),
    ("DELETE", B + "/{brandId}", "deleteBrand"),
    ("GET", B + "/{brandId}/logos/{slot}", "getBrandLogo"),
    ("PUT", B + "/{brandId}/logos/{slot}", "setBrandLogo"),
    ("DELETE", B + "/{brandId}/logos/{slot}", "clearBrandLogo"),
]

STUBS: list[Stub] = [*D2_STUBS]

router = APIRouter(tags=["brands"])
add_stubs(router, STUBS, project_scoped=False)


def stub_operation_ids() -> set[str]:
    """Every brands operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in STUBS}
```

In `backend/app/api.py`, replace:

```python
    "app.asset_models.runs",  # asset models (spec 2026-10-02); trimesh is native
):
```

with:

```python
    "app.asset_models.runs",  # asset models (spec 2026-10-02); trimesh is native
    # Asset findings (spec 2026-10-02-asset-findings §8, plan af-c0): 501 stubs until each unit lands.
    # A unit inserts its own router module above its stubs module and deletes its tuples there.
    "app.asset_review.stubs",
    "app.brands.stubs",
):
```

- [ ] **Step 4: The contract test allowances**

In `backend/tests/test_contract.py`, add the two imports to the `from app...` block, in order:

```python
from app.asset_review.stubs import stub_operation_ids as asset_review_stub_operation_ids
from app.brands.stubs import stub_operation_ids as brands_stub_operation_ids
from app.reports.router import stub_operation_ids as reports_stub_operation_ids
```

(the first two lines are new; the third already exists). After the line `EXPECTED_STUBS |= setup_stub_operation_ids()`, insert:

```python

# Asset findings (plan 2026-10-03-asset-findings-c0): the unit lists of app/asset_review/stubs.py
# (D1, J1 to J5) and app/brands/stubs.py (D2). An owner deletes its tuples; nothing here changes.
# The last owner of each module deletes the module, its line in app/api.py and its line here.
EXPECTED_STUBS |= asset_review_stub_operation_ids()
EXPECTED_STUBS |= brands_stub_operation_ids()
```

Replace:

```python
BACKEND_PENDING: dict[str, str] = {
    # Images I-C0 (plan 2026-09-27-images-c0): kept operations whose responses gained required
    # fields. Each unit deletes its lines once its routes fill them.
    # preannotateImage (I-FW): deleted from openapi.yaml, so no longer pending here.
}
```

with:

```python
BACKEND_PENDING: dict[str, str] = {
    # Images I-C0 (plan 2026-09-27-images-c0): kept operations whose responses gained required
    # fields. Each unit deletes its lines once its routes fill them.
    # preannotateImage (I-FW): deleted from openapi.yaml, so no longer pending here.
    # Asset findings C0 (plan 2026-10-03-asset-findings-c0): kept operations whose requests gained
    # values the backend refuses until the named unit lands (an `asset` anchor; the asset filters,
    # `anchor_kind=asset` and the `-height`/`zone` sorts; `frame`/`review` on a patch). That unit
    # deletes its line.
    "createFinding": "J4",
    "listFindings": "J4",
    "patchAssetModel": "J1",
}
```

- [ ] **Step 5: Run the stub test**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_stubs.py -q`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the contract test**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -x -k "not test_responses_conform"`
Expected: PASS. Every path is routed, no extra routes, and the allowances name real operations.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "asset or brand or finding or review or images or overview or search"`
Expected: PASS once Task 3 has landed. Without Task 3, every answer of `getAssetModel`, `listAssetModels`, `createAssetModel`, `getFinding`, `patchFinding` and `searchProject` fails `response_schema_conformance`, because it lacks the new required fields. When running Task 2 alone, check only that the failures are exactly those operations and exactly those fields.

- [ ] **Step 7: Commit**

```bash
git add backend/app/asset_review/__init__.py backend/app/asset_review/stubs.py backend/app/brands/__init__.py backend/app/brands/stubs.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_asset_findings_stubs.py
git commit -m "feat(asset-review): 501 stubs for the asset findings and brands operations (af-c0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Finding and asset model answers carry the new fields

**Files:**
- Modify: `backend/app/findings/schemas.py` (`FindingRepresentative`, `representative_of`, `FindingOut`)
- Modify: `backend/app/asset_models/schemas.py` (`AssetModelOut.frame`, `.review`; `AssetModelVersionOut.kind`)
- Create: `backend/tests/test_asset_findings_out.py`

**Interfaces:**
- Consumes: `app.db.models.Finding` (`anchor_kind`, `image_id`, `annotation_id`).
- Produces:
  - `app.findings.schemas.FindingRepresentative(image_id: str, annotation_id: str)`.
  - `app.findings.schemas.representative_of(r: Finding) -> FindingRepresentative | None`. It returns the image anchor's own annotation, else None. D1 adds the asset branch.
  - `FindingOut` gains `asset_model_id`, `height_m`, `bearing_deg`, `side`, `zone`, `component`, `placement`, `sighting_count` and `representative`. `FindingOut.from_row` answers None for the asset fields and 1 for `sighting_count`; D1 replaces those with the columns.
  - `AssetModelOut.frame: dict[str, Any] | None = None` and `AssetModelOut.review: dict[str, Any] | None = None`. They read the D1 columns through `from_attributes` once those exist, and default to None until then.
  - `AssetModelVersionOut.kind` accepts `"imported"`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_findings_out.py
"""Asset findings C0: every finding and asset model answer carries the fields spec
2026-10-02-asset-findings §8 adds (plan 2026-10-03-asset-findings-c0, Task 3). Until D1 adds the
asset columns, a finding answers them for its own kind: an image finding is its one implicit
sighting, and map and cloud findings have no sighting to show."""

from datetime import UTC, datetime

from findings_helpers import insert_box, insert_cloud

from app.asset_models.schemas import AssetModelVersionOut

API = "/api/v1"
ASSET_FIELDS = ["asset_model_id", "height_m", "bearing_deg", "side", "zone", "component", "placement"]


def _create(client, project_id: str, body: dict) -> dict:
    r = client.post(f"{API}/projects/{project_id}/findings", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_an_image_finding_is_its_own_representative_sighting(client, project_id, handle, crack):
    image_id, box_id = insert_box(handle, crack["id"])
    anchor = {"kind": "image", "image_id": image_id, "annotation_id": box_id}
    f = _create(client, project_id, {"type_id": crack["id"], "anchor": anchor})
    assert f["representative"] == {"image_id": image_id, "annotation_id": box_id}
    assert f["sighting_count"] == 1
    assert {k: f[k] for k in ASSET_FIELDS} == dict.fromkeys(ASSET_FIELDS)
    listed = client.get(f"{API}/projects/{project_id}/findings").json()["items"]
    assert [(x["representative"], x["sighting_count"]) for x in listed] == [(f["representative"], 1)]
    got = client.get(f"{API}/projects/{project_id}/findings/{f['id']}").json()
    assert got["representative"] == f["representative"]


def test_a_cloud_finding_has_no_representative(client, project_id, handle, crack):
    cloud_id = insert_cloud(handle)
    anchor = {"kind": "cloud", "cloud_id": cloud_id, "x": 1.0, "y": 2.0, "z": 3.0}
    f = _create(client, project_id, {"type_id": crack["id"], "anchor": anchor})
    assert (f["representative"], f["sighting_count"]) == (None, 1)
    assert {k: f[k] for k in ASSET_FIELDS} == dict.fromkeys(ASSET_FIELDS)


def test_an_asset_model_answers_its_frame_and_review_as_null(client, project_id):
    r = client.post(f"{API}/projects/{project_id}/asset-models", json={"name": "Stack"})
    assert r.status_code == 201, r.text
    assert (r.json()["frame"], r.json()["review"]) == (None, None)
    listed = client.get(f"{API}/projects/{project_id}/asset-models").json()["items"]
    assert [(m["frame"], m["review"]) for m in listed] == [(None, None)]


def test_a_version_may_be_imported():
    v = AssetModelVersionOut.model_validate(
        {
            "id": "v1",
            "model_id": "m1",
            "version": 1,
            "kind": "imported",
            "glb_status": "pending",
            "source_ids": [],
            "run_id": None,
            "note": None,
            "part_count": 0,
            "meta": None,
            "created_at": datetime(2026, 10, 3, tzinfo=UTC),
        }
    )
    assert v.kind == "imported"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_out.py -q`
Expected: FAIL. The finding tests fail with `KeyError: 'representative'`, the asset model test with `KeyError: 'frame'`, and the version test with a pydantic `literal_error` on `kind`.

- [ ] **Step 3: Implement**

In `backend/app/findings/schemas.py`, insert after `anchor_of` and before `class FindingOut`:

```python
class FindingRepresentative(BaseModel):
    image_id: str
    annotation_id: str


def representative_of(r: Finding) -> FindingRepresentative | None:
    """The sighting a finding is shown by (spec 2026-10-02-asset-findings §8). An image finding is
    its own one implicit sighting (§4 A2); map and cloud findings have none. D1 adds the asset
    branch (the representative `finding_sighting`)."""
    if r.anchor_kind == "image":
        return FindingRepresentative(image_id=r.image_id, annotation_id=r.annotation_id)
    return None
```

In `FindingOut`, after `closed_at: datetime | None`, add:

```python
    # Asset findings (spec 2026-10-02-asset-findings §8). C0 answers them for the kinds that exist
    # today; D1 reads the asset columns.
    asset_model_id: str | None
    height_m: float | None
    bearing_deg: float | None
    side: str | None
    zone: str | None
    component: str | None
    placement: Literal["point", "patch", "none"] | None
    sighting_count: int
    representative: FindingRepresentative | None
```

And in `FindingOut.from_row`, after `closed_at=r.closed_at,`, add:

```python
            asset_model_id=None,
            height_m=None,
            bearing_deg=None,
            side=None,
            zone=None,
            component=None,
            placement=None,
            sighting_count=1,
            representative=representative_of(r),
```

In `backend/app/asset_models/schemas.py`, in `AssetModelOut`, after `updated_at: datetime`, add:

```python
    # Spec 2026-10-02-asset-findings §5.1: read from D1's columns once they exist; None until then.
    frame: dict[str, Any] | None = None
    review: dict[str, Any] | None = None
```

And in `AssetModelVersionOut`, replace `kind: Literal["agent", "manual", "draft"]` with `kind: Literal["agent", "manual", "draft", "imported"]`.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/findings/schemas.py app/asset_models/schemas.py tests/test_asset_findings_out.py`

- [ ] **Step 4: Run it to verify it passes, with the finding and asset model suites**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_out.py tests/test_findings_api.py tests/test_findings_invariant.py tests/test_asset_models_api.py tests/test_map_findings.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/findings/schemas.py backend/app/asset_models/schemas.py backend/tests/test_asset_findings_out.py
git commit -m "feat(findings): answer the asset fields and the representative sighting (af-c0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3b: `ReportConfig.brand_id` in the backend mirror

**Files:**
- Modify: `backend/app/reports/schemas.py` (`ReportConfig.brand_id`)
- Modify: `backend/tests/test_catalogue_migration_0002.py` (the frozen-copy pin ignores keys added after 0002)
- Test: `backend/tests/test_reports_contract.py` (unchanged; it already demands the mirror), `backend/tests/test_asset_findings_report_brand.py` (new)

**Interfaces:**
- Consumes: Task 1's `ReportConfig.brand_id` (`[string, "null"]`, maxLength 64, required).
- Produces: `app.reports.schemas.ReportConfig.brand_id: str | None = Field(None, max_length=64)`. It is stored inside `report.config` and `report_template.config`; a config saved before it existed reads `None`. D2 Task 4 Step 8 finds it present and skips. R1 reads it for the PDF.
- Why no catalogue migration: the 0002 seed rows lack `brand_id`, and `ReportConfig` fills `None` when they are read (`test_the_seeded_rows_are_the_code_built_ins` stays green). The frozen-copy pin compares the 0002 seed with the code dump minus the keys added after 0002, so 0002's history is never rewritten. R1 adds its own config keys to the same set (Appendix A).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_findings_report_brand.py
"""Asset findings C0: a report config names its brand (spec 2026-10-02-asset-findings §5.8, plan
af-c0 Task 3b). Null, or a config saved before the field existed, prints with the Kestrel theme."""

import pytest
from pydantic import ValidationError

from app.reports.schemas import ReportConfig


def test_a_new_config_has_no_brand():
    assert ReportConfig().brand_id is None
    assert ReportConfig().model_dump(mode="json", by_alias=True)["brand_id"] is None


def test_a_config_saved_before_brands_reads_none():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    del raw["brand_id"]
    assert ReportConfig.model_validate(raw).brand_id is None


def test_a_brand_id_round_trips_and_is_bounded():
    assert ReportConfig.model_validate({"brand_id": "builtin-eand"}).brand_id == "builtin-eand"
    with pytest.raises(ValidationError):
        ReportConfig.model_validate({"brand_id": "x" * 65})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_report_brand.py tests/test_reports_contract.py -q`
Expected: FAIL. The new tests fail with `AttributeError: 'ReportConfig' object has no attribute 'brand_id'`, and `test_the_pydantic_model_mirrors_the_contract_schema[ReportConfig]` fails on the extra contract property.

- [ ] **Step 3: Implement**

In `backend/app/reports/schemas.py`, in `class ReportConfig(_Strict)`, after the `sections` field, add:

```python
    # Spec 2026-10-02-asset-findings §5.8: a `Brand` id; None (or a brand since deleted) is the
    # Kestrel theme. Configs saved before it existed read None.
    brand_id: str | None = Field(None, max_length=64)
```

In `backend/tests/test_catalogue_migration_0002.py`, replace `test_the_migration_carries_a_frozen_copy` with:

```python
# Report config keys added after 0002 (each with a default that a seeded row reads back): the
# frozen 0002 seed never carries them, and must not be rewritten to. R1 adds its keys here.
ADDED_AFTER_0002 = {"brand_id"}


def test_the_migration_carries_a_frozen_copy():
    """A later edit of builtins.py must not rewrite 0002's history, and the two must agree today."""
    assert "from app" not in PATH.read_text(encoding="utf-8")
    frozen = [{k: row[k] for k in ("id", "name", "description", "config")} for row in _module().BUILTIN_ROWS]
    code = [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "config": {
                k: v
                for k, v in t.config.model_dump(mode="json", by_alias=True).items()
                if k not in ADDED_AFTER_0002
            },
        }
        for t in BUILTIN_TEMPLATES
    ]
    assert frozen == code
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format app/reports/schemas.py tests/test_catalogue_migration_0002.py tests/test_asset_findings_report_brand.py`

- [ ] **Step 4: Run it to verify it passes, with the reports and catalogue suites**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_report_brand.py tests/test_reports_contract.py tests/test_report_builtins.py tests/test_catalogue_migration_0002.py tests/test_catalogue_migration_0003.py -q`
Expected: PASS.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests -q -k "report"`
Expected: PASS. If a test compares a whole stored config with a dict literal, add `"brand_id": None` to that literal; never drop the field from the dump.

- [ ] **Step 5: Commit**

```bash
git add backend/app/reports/schemas.py backend/tests/test_catalogue_migration_0002.py backend/tests/test_asset_findings_report_brand.py
# plus any report test Step 4 touched, by path
git commit -m "feat(reports): a report config names its brand (af-c0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client aliases and URL builders

**Files:**
- Modify: `contract/client/index.ts`
- Create: `frontend/src/api/assetReviewUrls.test.ts`

**Interfaces:**
- Consumes: `contract/client/schema.d.ts` (Task 1).
- Produces (module exports of `@contract/client`):
  - `placementMeshUrl(baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string): string`
  - `placementTextureUrl(…same…): string`
  - `placementLabelsUrl(…same…): string`
  - `brandLogoUrl(baseUrl: string, token: string, brandId: string, slot: BrandLogoSlot): string`
  - Type aliases: `AssetVec3`, `AssetFrame`, `AssetFrameOrigin`, `AssetFramePreset`, `AssetFrameConversion`, `AssetProfileId`, `AssetReviewConfig`, `AssetReviewZone`, `AssetReviewChoice`, `AssetGlbImport`, `ImagePose`, `ImagePoseIn`, `ImagePoseList`, `ImagePoseSource`, `ImagePoseEstimate`, `ImageReview`, `ImageReviewPut`, `ImageReviewStatus`, `Placement`, `PlacementList`, `PlacementCompute`, `FindingAssetAnchor`, `FindingAssetAnchorInput`, `FindingSightingInput`, `FindingSighting`, `FindingSightingList`, `FindingSightingPlacement`, `FindingRepresentative`, `FindingMerge`, `FindingSplit`, `ReviewImportRequest`, `ReviewImportPreview`, `Brand`, `BrandList`, `BrandCreate`, `BrandPatch`, `BrandColors`, `BrandLogoSlot`, `BrandLogoImport`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/api/assetReviewUrls.test.ts
import { describe, expect, it } from "vitest";
import { brandLogoUrl, placementLabelsUrl, placementMeshUrl, placementTextureUrl } from "@contract/client";

const BASE = "http://127.0.0.1:8765/";

describe("asset review URL builders", () => {
  it("put the token in the query, since <img> and fetch-by-URL cannot send headers", () => {
    const p = "http://127.0.0.1:8765/api/v1/projects/p1/asset-models/m1/placements/s1";
    expect(placementMeshUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/mesh?token=t+k`);
    expect(placementTextureUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/texture?token=t+k`);
    expect(placementLabelsUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/labels?token=t+k`);
  });

  it("serves brand logos from the app-wide brands API", () => {
    expect(brandLogoUrl(BASE, "tok", "b1", "on_dark")).toBe(
      "http://127.0.0.1:8765/api/v1/brands/b1/logos/on_dark?token=tok",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/api/assetReviewUrls.test.ts`
Expected: FAIL with `placementMeshUrl is not a function` (or an import error naming it).

- [ ] **Step 3: Implement**

In `contract/client/index.ts`, after `export type AssetModelRunStart = Schemas["AssetModelRunStart"];`, add:

```ts
export type AssetVec3 = Schemas["AssetVec3"];
export type AssetFrame = Schemas["AssetFrame"];
export type AssetFrameOrigin = Schemas["AssetFrameOrigin"];
export type AssetFramePreset = Schemas["AssetFramePreset"];
export type AssetFrameConversion = Schemas["AssetFrameConversion"];
export type AssetProfileId = Schemas["AssetProfileId"];
export type AssetReviewConfig = Schemas["AssetReviewConfig"];
export type AssetReviewZone = Schemas["AssetReviewZone"];
export type AssetReviewChoice = Schemas["AssetReviewChoice"];
export type AssetGlbImport = Schemas["AssetGlbImport"];
export type ImagePose = Schemas["ImagePose"];
export type ImagePoseIn = Schemas["ImagePoseIn"];
export type ImagePoseList = Schemas["ImagePoseList"];
export type ImagePoseSource = Schemas["ImagePoseSource"];
export type ImagePoseEstimate = Schemas["ImagePoseEstimate"];
export type ImageReview = Schemas["ImageReview"];
export type ImageReviewPut = Schemas["ImageReviewPut"];
export type ImageReviewStatus = Schemas["ImageReviewStatus"];
export type Placement = Schemas["Placement"];
export type PlacementList = Schemas["PlacementList"];
export type PlacementCompute = Schemas["PlacementCompute"];
export type FindingAssetAnchor = Schemas["FindingAssetAnchor"];
export type FindingAssetAnchorInput = Schemas["FindingAssetAnchorInput"];
export type FindingSightingInput = Schemas["FindingSightingInput"];
export type FindingSighting = Schemas["FindingSighting"];
export type FindingSightingList = Schemas["FindingSightingList"];
export type FindingSightingPlacement = Schemas["FindingSightingPlacement"];
export type FindingRepresentative = Schemas["FindingRepresentative"];
export type FindingMerge = Schemas["FindingMerge"];
export type FindingSplit = Schemas["FindingSplit"];
export type ReviewImportRequest = Schemas["ReviewImportRequest"];
export type ReviewImportPreview = Schemas["ReviewImportPreview"];
export type Brand = Schemas["Brand"];
export type BrandList = Schemas["BrandList"];
export type BrandCreate = Schemas["BrandCreate"];
export type BrandPatch = Schemas["BrandPatch"];
export type BrandColors = Schemas["BrandColors"];
export type BrandLogoSlot = Schemas["BrandLogoSlot"];
export type BrandLogoImport = Schemas["BrandLogoImport"];
```

After `assetModelOverlayUrl`, add:

```ts
function placementFileUrl(
  part: "mesh" | "texture" | "labels",
  baseUrl: string,
  token: string,
  projectId: string,
  assetModelId: string,
  sightingId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/asset-models/${assetModelId}/placements/${sightingId}/${part}?${q}`;
}

/** A patch's triangles: little-endian Float32 positions then uvs (contract `getPlacementMesh`). */
export function placementMeshUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("mesh", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A patch's PNG texture with alpha (contract `getPlacementTexture`). */
export function placementTextureUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("texture", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A patch's uint8 label grid for pixel-exact picking (contract `getPlacementLabels`). */
export function placementLabelsUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("labels", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A brand's logo in one slot (contract `getBrandLogo`); brands are app-wide, not per project. */
export function brandLogoUrl(baseUrl: string, token: string, brandId: string, slot: BrandLogoSlot): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/brands/${brandId}/logos/${slot}?${q}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/api/assetReviewUrls.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add contract/client/index.ts frontend/src/api/assetReviewUrls.test.ts
git commit -m "feat(contract): asset findings client aliases and placement and brand logo URLs (af-c0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keep the frontend compiling

**Files:**
- Modify: `frontend/src/agent/project/ToolRow.tsx` (`JOB_NAME`)
- Modify: `frontend/src/app/jobVerbs.ts` (`JOB_VERB`)
- Modify: `frontend/src/jobs/JobCard.tsx` (`TYPE_ICON`)
- Modify: `frontend/src/jobs/jobLabels.ts` (`TYPE_LABEL`, `resultTarget`)
- Modify: `frontend/src/ui/useJobToasts.ts` (`TYPE_NAME`, `jobToastText`)
- Modify: `frontend/src/findings/location.ts` (records keyed by anchor kind)
- Modify: `frontend/src/test/findingFixtures.ts` (`exampleFinding`, `exampleFinding2`)
- Modify: `frontend/src/test/assetModelFixtures.ts` (`MODEL`)
- Modify: `frontend/src/clouds/workspace/features/pins.test.tsx` (`saved`: a cloud finding has no representative)
- Modify: `frontend/e2e/fixtures/assetModels.ts` (`modelJson`)
- Modify: any other file `tsc` names in Step 4, by the same rules
- Create: `frontend/src/jobs/assetFindingsJobTypes.test.ts`
- Create: `frontend/src/findings/location.test.ts`

**Interfaces:**
- Consumes: `Job["type"]` with the five new members; `Finding["anchor"]["kind"]` with `"asset"`; `Finding` with nine new required fields; `AssetModel` with `frame` and `review`.
- Produces: each new job type is titled, phrased, iconed and toasted. A succeeded asset job links to `/p/{projectId}/models/{asset_model_id}`. A review dry run has no link, and its toast reads "Review checked". `findingLocation` names an asset finding by its model, with fallback "Asset model" and icon `cube`. U4 adds the `asset` source filter on top of this.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/jobs/assetFindingsJobTypes.test.ts
import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { JOB_VERB } from "@/app/jobVerbs";
import { runningJob } from "@/test/fixtures";
import { jobToastText } from "@/ui";
import { jobTitle, resultTarget } from "./jobLabels";

/** The five asset findings job types (spec 2026-10-02-asset-findings §6, plan af-c0). */
const job = (type: Job["type"], params: Record<string, unknown> = { asset_model_id: "m1" }): Job => ({
  ...runningJob,
  type,
  params,
});

const TYPES = ["asset_glb_import", "asset_pose", "asset_place", "asset_group", "review_kit_import"] as const;

describe("the asset findings job types", () => {
  it.each([
    ["asset_glb_import", "GLB import", "Importing a GLB", "GLB imported"],
    ["asset_pose", "Photo poses", "Estimating photo poses", "Photo poses estimated"],
    ["asset_place", "Sighting placement", "Placing sightings", "Sightings placed"],
    ["asset_group", "Sighting grouping", "Grouping sightings", "Sightings grouped into findings"],
    ["review_kit_import", "Review import", "Importing a review", "Review imported"],
  ] as const)("%s is titled, phrased and toasted", (type, title, verb, toast) => {
    expect(jobTitle(job(type))).toBe(title);
    expect(JOB_VERB[type]).toBe(verb);
    expect(jobToastText({ ...job(type), state: "succeeded" })).toBe(toast);
  });

  it("links to the asset model when it succeeds", () => {
    for (const type of TYPES) {
      expect(resultTarget({ ...job(type), state: "succeeded" }, "p")).toEqual({
        label: "Open asset model",
        to: "/p/p/models/m1",
      });
    }
    const fromResult = { ...job("asset_place", {}), state: "succeeded" as const, result: { asset_model_id: "m2" } };
    expect(resultTarget(fromResult, "p")?.to).toBe("/p/p/models/m2");
    expect(resultTarget({ ...job("asset_group", {}), state: "succeeded" }, "p")?.to).toBe("/p/p/models");
  });

  it("treats a review dry run as a check, not an import", () => {
    const dry = { ...job("review_kit_import", { dry_run: true }), state: "succeeded" as const };
    expect(jobToastText(dry)).toBe("Review checked");
    expect(resultTarget(dry, "p")).toBeNull();
  });

  it("names the job in a failure toast", () => {
    expect(jobToastText({ ...job("asset_place"), state: "failed", error: "The GLB has no faces" })).toBe(
      "Sighting placement failed: The GLB has no faces",
    );
  });
});
```

```ts
// frontend/src/findings/location.test.ts
import { describe, expect, it } from "vitest";
import type { Finding } from "@/api/findings";
import { exampleFinding } from "@/test/findingFixtures";
import { findingLocation } from "./location";

const assetFinding: Finding = {
  ...exampleFinding,
  anchor: { kind: "asset", asset_model_id: "m1", asset_version: 2, point: null, normal: null },
  data_type: "asset_model",
  data_id: "m1",
  asset_model_id: "m1",
  representative: null,
  sighting_count: 0,
};

describe("findingLocation", () => {
  it("names an asset finding by its asset model", () => {
    expect(findingLocation(assetFinding, new Map([["m1", "Flare stack"]]))).toEqual({
      icon: "cube",
      primary: "Flare stack",
      secondary: null,
    });
  });

  it("falls back to the kind's label when the model is not in the data list", () => {
    expect(findingLocation(assetFinding, new Map()).primary).toBe("Asset model");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/jobs/assetFindingsJobTypes.test.ts src/findings/location.test.ts`
Expected: FAIL. `jobTitle` answers `undefined` for the new types, and `findingLocation` answers icon `undefined` for `asset`.

- [ ] **Step 3: Implement**

`frontend/src/agent/project/ToolRow.tsx`, in `JOB_NAME`, after `asset_model_run: "Run asset model agent",`:

```ts
  asset_glb_import: "GLB import",
  asset_pose: "Photo poses",
  asset_place: "Sighting placement",
  asset_group: "Sighting grouping",
  review_kit_import: "Review import",
```

`frontend/src/jobs/jobLabels.ts`, in `TYPE_LABEL`, after `asset_model_run: "Run asset model agent",`, the same five lines. Then in `resultTarget`, after the `asset_model_glb` / `asset_model_run` case block (before the switch's closing `}`), add:

```ts
    case "asset_glb_import":
    case "asset_pose":
    case "asset_place":
    case "asset_group":
    case "review_kit_import": {
      // A dry run writes nothing: its preview is read by the import dialog that started it.
      if (job.type === "review_kit_import" && job.params?.dry_run === true) return null;
      const id = str(job.params, "asset_model_id") ?? str(job.result, "asset_model_id");
      return { label: "Open asset model", to: id ? `${p}/models/${id}` : `${p}/models` };
    }
```

`frontend/src/ui/useJobToasts.ts`, in `TYPE_NAME`, after `asset_model_run: "Run asset model agent",`, the same five lines. In `jobToastText`, after `case "asset_model_run": return "Asset model run finished";`:

```ts
    case "asset_glb_import":
      return "GLB imported";
    case "asset_pose":
      return "Photo poses estimated";
    case "asset_place":
      return "Sightings placed";
    case "asset_group":
      return "Sightings grouped into findings";
    case "review_kit_import":
      return job.params?.dry_run === true ? "Review checked" : "Review imported";
```

`frontend/src/app/jobVerbs.ts`, in `JOB_VERB`, after `asset_model_run: "Building asset model",`:

```ts
  asset_glb_import: "Importing a GLB",
  asset_pose: "Estimating photo poses",
  asset_place: "Placing sightings",
  asset_group: "Grouping sightings",
  review_kit_import: "Importing a review",
```

`frontend/src/jobs/JobCard.tsx`, in `TYPE_ICON`, after `asset_model_run: "cube",`:

```ts
  asset_glb_import: "cube",
  asset_pose: "camera",
  asset_place: "pin",
  asset_group: "findings",
  review_kit_import: "import",
```

`frontend/src/findings/location.ts`. Replace the imports and the two records:

```ts
import type { Finding } from "@/api/findings";
import type { IconName } from "@/ui";
import type { SourceKind } from "./filters";

const SOURCE_ICON: Record<SourceKind, IconName> = { image: "images", map: "map", cloud: "cloud" };

export const SOURCE_LABEL: Record<SourceKind, string> = { image: "Images", map: "Map", cloud: "Point cloud" };
```

with:

```ts
import type { Finding } from "@/api/findings";
import type { IconName } from "@/ui";

/** Keyed by the anchor kind, so a new kind fails to compile here rather than render blank. */
type AnchorKind = Finding["anchor"]["kind"];

const SOURCE_ICON: Record<AnchorKind, IconName> = { image: "images", map: "map", cloud: "cloud", asset: "cube" };

export const SOURCE_LABEL: Record<AnchorKind, string> = {
  image: "Images",
  map: "Map",
  cloud: "Point cloud",
  asset: "Asset model",
};
```

`frontend/src/test/findingFixtures.ts`. In `exampleFinding`, after `closed_at: null,`:

```ts
  asset_model_id: null,
  height_m: null,
  bearing_deg: null,
  side: null,
  zone: null,
  component: null,
  placement: null,
  sighting_count: 1,
  representative: { image_id: IMAGE_ID, annotation_id: ANNOTATION_ID },
```

In `exampleFinding2` (a map finding), after `closed_at: "2026-09-20T08:00:00Z",`, add `representative: null,`.

`frontend/src/clouds/workspace/features/pins.test.tsx`. In `saved`, after `data_id: CLOUD_ID,`, add `representative: null,`.

`frontend/src/test/assetModelFixtures.ts`. In `MODEL`, after `updated_at: "2026-10-02T09:00:00Z",`, add:

```ts
  frame: null,
  review: null,
```

`frontend/e2e/fixtures/assetModels.ts`. In `modelJson`, after `updated_at: T,`, add the same two lines. This is the mock's JSON, so U2's e2e reads the shape the backend answers.

Run: `pnpm -C frontend exec prettier --write src/agent/project/ToolRow.tsx src/app/jobVerbs.ts src/jobs/JobCard.tsx src/jobs/jobLabels.ts src/ui/useJobToasts.ts src/findings/location.ts src/findings/location.test.ts src/jobs/assetFindingsJobTypes.test.ts src/test/findingFixtures.ts src/test/assetModelFixtures.ts src/clouds/workspace/features/pins.test.tsx src/api/assetReviewUrls.test.ts`

- [ ] **Step 4: Build, and fix what `tsc` still names**

Run: `pnpm -C frontend build`
Expected: green. If `tsc` names another file, apply the matching rule. Never widen a type to `Partial`, never cast around the error, never add `// @ts-expect-error`.
- A `Record<Job["type"], …>`: add the five entries, with the same wording as above.
- A switch over `job.type` that must return: add the five cases.
- A `Record` indexed by `finding.anchor.kind`: key it by `Finding["anchor"]["kind"]` and add `asset`.
- An `if`/`else` chain on `anchor.kind` whose last branch reads cloud fields: narrow it with `anchor.kind === "cloud"`, and return the branch's empty value for `asset`.
- A typed `Finding` or `FindingDetail` literal that does not spread `exampleFinding`: add the nine fields from the `exampleFinding` block. A non-image anchor gets `representative: null`.
- A typed `AssetModel` literal: add `frame: null, review: null`.
- A typed `ReportConfig` literal, or a builder default config (`frontend/src/reports/builderModel.ts`, `frontend/src/test/reportBuilderFixtures.ts` are the likely ones): add `brand_id: null`.

List every extra file in the commit.

- [ ] **Step 5: Run the frontend tests**

Run: `pnpm -C frontend exec vitest run src/jobs src/findings src/api/assetReviewUrls.test.ts src/clouds/workspace/features/pins.test.tsx src/assetmodels`
Expected: PASS.

Run: `pnpm -C frontend lint`
Expected: PASS (eslint, prettier, check-tokens; no raw colours added).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/agent/project/ToolRow.tsx frontend/src/app/jobVerbs.ts frontend/src/jobs/JobCard.tsx frontend/src/jobs/jobLabels.ts frontend/src/ui/useJobToasts.ts frontend/src/findings/location.ts frontend/src/findings/location.test.ts frontend/src/jobs/assetFindingsJobTypes.test.ts frontend/src/test/findingFixtures.ts frontend/src/test/assetModelFixtures.ts frontend/src/clouds/workspace/features/pins.test.tsx frontend/e2e/fixtures/assetModels.ts
# plus every file Step 4 touched, by path
git commit -m "feat(frontend): name the asset findings jobs and the asset anchor kind (af-c0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gate and land

- [ ] **Step 1: The full gate, from the worktree root**

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. `pnpm -C contract check` regenerates `schema.d.ts` and diffs it, so it must match the committed file. `cargo test --manifest-path frontend/src-tauri/Cargo.toml` runs only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists in the worktree. A fresh worktree does not have it, so the step is skipped, not failed.

If `tests/test_contract.py` reports an operation outside this unit, read the failure before touching anything. The usual cause is a new required field that an answer lacks: fix the answer, never the allowance. An unexpected stub for an operation means a tuple path does not match the contract literally: fix the tuple.

- [ ] **Step 2: Nothing retired, nothing packaged**

C0 adds routes and renames none, and it adds no Python package. Confirm with `git diff main --stat -- backend/scripts backend/requirements.txt backend/kestrel_backend.spec frontend/src-tauri/capabilities`, which should print nothing.

- [ ] **Step 3: Land**

Run `scripts\finish-task.ps1`. If it fails on Windows PowerShell 5.1 (the known `&&` parse failure), land by hand from the main checkout:
1. `git merge --no-ff task/af-c0 -m "merge: af-c0 into main (asset findings contract)"`
2. Remove the worktree. Delete its junction links (the shared `node_modules`) as links first, never with `rm -rf`, then run `git worktree remove .claude/worktrees/af-c0`.
3. `git branch -d task/af-c0`

- [ ] **Step 4: Operator walkthrough**

This change is not user-observable: it adds API shapes that answer 501, and the app looks and behaves as before.

---

## Appendix A: the other report config additions, for R1

These are binding values for R1 (Index note 1), in YAML ready to paste. R1 lands them in one commit, together with:
- `backend/app/reports/schemas.py`, the one-to-one pydantic mirror;
- the built-in templates;
- the keys `csv_layout` and `min_severity` (and the `asset_summary` section) handled in `test_catalogue_migration_0002.py` the way Task 3b handles `brand_id`. Extend `ADDED_AFTER_0002` for top-level keys; for nested ones (`min_severity` inside a section's options, the `asset_summary` section itself) strip them from the code dump the same way. No catalogue migration is needed, because the seeded rows read back with the defaults.

1. `SectionKey`: `enum: [cover, summary, asset_summary, findings_table, finding_pages, measurements, comparison, object_counts, appendix]`. `SECTION_KEYS` follows this order.
2. New options and section:

```yaml
    AssetSummaryOptions:
      type: object
      additionalProperties: false
      required: [asset_model_id, show_map, show_tables]
      properties:
        asset_model_id: { type: [string, "null"], description: "the asset model to summarise; null is the first asset model with findings in the filter" }
        show_map: { type: boolean, description: "the asset findings map" }
        show_tables: { type: boolean, description: "the zone and side breakdown tables" }
    ReportSectionAssetSummary:
      type: object
      additionalProperties: false
      required: [key, enabled, options]
      properties:
        key: { type: string, enum: [asset_summary] }
        enabled: { type: boolean }
        options: { $ref: "#/components/schemas/AssetSummaryOptions" }
```

   `ReportSection` gains `- $ref: "#/components/schemas/ReportSectionAssetSummary"` and the mapping `asset_summary: "#/components/schemas/ReportSectionAssetSummary"`.
3. `FindingsTableOptions.columns`: `maxItems: 11`, and `items.enum: [number, type, severity, status, data_item, observed, note, zone, side, height, sightings]`.
4. `FindingPagesOptions`: `required: [snapshots, photos_max, comments, context_inset, min_severity]`, and the property `min_severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "only findings at this severity or above get a page; null is every finding" }`.
5. `ReportConfig`:
   - `required: [cover, paper, filters, sections, brand_id, csv_layout]` (`brand_id` is already there from C0).
   - New property:

```yaml
        csv_layout: { type: string, enum: [findings, asset_sightings], description: "`asset_sightings`: the kit's 21 columns, UTF-8 with BOM, CRLF, then photos without findings" }
```

   - `sections`: `minItems: 8, maxItems: 9`. Description: "a config saved before `asset_summary` existed lists eight; it reads as disabled".
   - The `example` gains `csv_layout: findings`, and the section `{ key: asset_summary, enabled: false, options: { asset_model_id: null, show_map: true, show_tables: true } }` after `summary`. The example must stay equal to the default config (`test_the_config_example_is_the_default_config`).

Every place this ripples to, found while planning C0:
- `backend/tests/test_reports_contract.py`:
  - `test_a_config_always_lists_the_eight_sections` asserts `(8, 8)`, which becomes `(8, 9)`;
  - the mirror, enum and example tests follow `schemas.py`.
- `backend/app/reports/templates/builtins.py` and `backend/tests/test_report_builtins.py`: every built-in lists every key in `SECTION_KEYS`.
- `backend/tests/test_catalogue_migration_0002.py::test_the_migration_carries_a_frozen_copy` compares the 0002 seed with the code dump minus `ADDED_AFTER_0002` (Task 3b). R1 strips its new keys the same way.
- `backend/app/reports/compose.py::SECTION_MODULES`:
  - Every key needs a module. Without one, an `asset_summary` section raises `KeyError` in compose and in `outline.section_etag`.
  - R1 adds `backend/app/reports/sections/asset_summary.py` (`KEY`, `TITLE = "Asset summary"`, `USES_FINDINGS = True`, and its `compose`), registered in the same commit as the contract change.
- Frontend:
  - `frontend/src/reports/builderModel.ts` (`SECTION_LABEL`), `frontend/src/api/reports.ts` (`SECTION_TITLES`) and `frontend/src/reports/preview/fixtures.ts` (`FIXTURE_BLOCKS`) are `Record<SectionKey, …>` and need an `asset_summary` entry.
  - The builder's default config gains `csv_layout`.

---

## Self-review

**Spec coverage for C0:**
- §8: every row is an operation above.
  - Action paths are slash verbs (index amendment).
  - `GET`/`PUT /images/{id}/review` is two operations.
  - Brands are four operations, plus the logo PUT and GET (Index note 4).
- §8 `FindingOut` additions: in `Finding` (Task 1) and answered by `FindingOut` (Task 3).
- §5.1: the shapes are `AssetFrame` and `AssetReviewConfig`.
- §5.2: `AssetModelVersion.kind` `imported` and its `meta`.
- §5.3: `ImagePose` and `ImagePoseIn`.
- §5.4: `ImageReview`.
- §5.5: `FindingAssetAnchor` and the `Finding` fields.
- §5.6: `FindingSighting`.
- §5.7: the three binary formats are described in the responses.
- §5.8: `Brand`, its logo operations, and `ReportConfig.brand_id` (Task 1, Task 3b).
- §6: five `JobType` values, and `Job.result` documents each result and params shape.
- §9:
  - `getImageIndex` takes `review_status` (register outcome chips).
  - `OverviewHero.kind` takes `asset_model`, and `ProjectOverview.photo_review` carries the counts behind the outcome bar (the Overview asset hero).
  - `listFindings` takes the asset filters and sorts (register and Findings topic).
  - `FindingSighting` carries the split-inspection HUD's height, side and capture time.
- §11: pages are capped at 2,000 and patch files are fetched per patch.
- §10: the remaining report config pieces are in Appendix A, for R1.

**No placeholders:** every YAML block, Python module, test and TypeScript edit is written out. Task 5 Step 4 gives a rule per error class for any file `tsc` names beyond the ones found while planning, and never "fix as needed".

**Type consistency:**
- The `ASSET_FINDINGS_OPERATIONS` paths equal the stub tuples plus their prefix. `test_each_stub_sits_in_its_units_list_with_the_contract_path` pins this.
- The job type strings match across `openapi.yaml` and the five frontend maps.
- `placement` is `point | patch | none | null` on `Finding`, `point | patch` on `Placement`, and `point | patch | none | pending` on `FindingSighting`, matching spec §5.5 and §5.6.

**Last task is the gate:** Task 6 runs the AGENTS.md gate verbatim.

## Index notes

1. **Report config: C0 lands `brand_id`, R1 the rest.** The coordinator ruled that `ReportConfig.brand_id` is in C0. The other report config names stay as the index wrote them, but they move to R1: `csv_layout`, `SectionKey` `asset_summary`, the `FindingsTableColumn` additions, and `FindingPagesSection.min_severity` (the real schema is `FindingPagesOptions`). The repo forces each of these into one commit with backend reports code:
   - `test_reports_contract.py` demands that `app/reports/schemas.py` mirror the contract one to one. It also requires every config property and forbids `default`.
   - `test_catalogue_migration_0002.py` pins the built-in templates' config dump against the frozen 0002 seed.
   - `compose.SECTION_MODULES` needs a module per section key.

   For `brand_id`, Task 3b mirrors the field. It also makes the 0002 pin ignore keys added after 0002 (`ADDED_AFTER_0002`), since a seeded row reads them back as defaults; no catalogue migration is needed. R1 owns `app/reports/*` and the section modules, so it lands the rest from Appendix A's exact YAML, in the same pattern.
2. **`FindingOut` and `AssetModelOut` gain the new fields in C0 (Task 3)**, with the values for today's kinds (`representative` = an image finding's own annotation, `sighting_count` = 1, asset fields null). Without this, `getFinding`, `patchFinding`, `searchProject`, `listFindings` and every asset model answer would need `BACKEND_PENDING` until D1. D1 then reads its columns in `from_row`, plus the asset branch of `representative_of` and `anchor_of`.
3. **`BACKEND_PENDING`** gains `createFinding` and `listFindings` (J4 deletes them) and `patchAssetModel` (J1). Each owner of a new operation adds its own `REFUSES_VALID_DATA` entry when it lands. Examples: `importAssetModelGlb {409, 422}`, `estimateImagePoses {409, 422}`, `computePlacements {409}`, `regroupAssetFindings {409}`, `mergeFinding {422}`, `splitFinding {422}`, `startReviewImport {409, 422}`, `createBrand {409, 422}`, `patchBrand {409, 422}`, `deleteBrand {409}`, `setBrandLogo {422}`, `patchAssetModel {422}`.
4. **Three brand logo operations were added**: `getBrandLogo`, `setBrandLogo` and `clearBrandLogo` (owner D2). Their shape follows the coordinator ruling and is D2 Task 1's end state verbatim (`BrandLogoSlot`, `BrandLogoImport`, bundled font family names, 422 `unknown_font`). The client gets a `brandLogoUrl` builder. Spec §5.8 calls the logos "report-asset ids", but report assets are per project and brands are app-wide. The e& logos must also be imported once through the editor and shown in its live preview. `Brand.logo_*` therefore holds brand logo ids served by `getBrandLogo`.
5. **`review_status` was added to `getImageIndex`**, in exactly U4 Task 1's shape: a comma-separated string with a pattern. The coordinator ruled that U4 skips its Task 1; U4 Task 8 implements the backend filter. The register's outcome chips (spec §9) open the image browser filtered by review status, and no operation offered that filter. FastAPI ignores the parameter until U4 Task 8 implements it.
6. **`OverviewHero.kind` gains `asset_model`, ordered first, and `ProjectOverview` gains the optional `photo_review` (`PhotoReviewCounts`).** Both follow the coordinator ruling and match U5 Task 1 Step 3 exactly. U5 Task 1 keeps its backend steps (hero selection and counts in `backend/app/overview/`) and skips its contract step. C0 leaves `backend/app/overview/schemas.py` unchanged: `photo_review` is optional, and the hero Literal only widens when U5 lands.
7. **The register's "source" filter is the existing `anchor_kind` query parameter.** `FindingAnchorKind += asset` covers the index's "`source` filter accepts `asset`"; there is no separate `source` parameter.
8. **`Placement.has_patch` replaces spec §8's `patch_url?`.** The URL would carry the token pattern and duplicate the client builders (`placementMeshUrl` and its siblings), which build it from ids.
9. **`mergeFinding` answers `Finding`**, as the index says, not `FindingDetail`. A client that needs the counts refetches `getFinding`.
10. **`AssetReviewConfig` adds three fields to spec §5.1's key list: `component_map`, `report.facts` and `report.limits`.** Spec §6.3 (`component_map`) and §7 (`facts` order, `limits` text) need them. P1's `ReviewConfig` must mirror these keys exactly.
11. **Pages use `after` and `next`**, per the index, not the repo's `cursor` and `next_cursor`. Their value is a plain row id, never decoded, so a generated value is never "malformed" in `test_contract.py`.
12. **`FindingSighting` carries extra fields:** derived `height_m`, `bearing_deg`, `side` and `zone`, computed on read by P1's `derive`, plus `image_name` and `captured_at`. Split inspection's HUD (spec §9) shows height, side and capture time per sighting, and `finding_sighting` stores none of them.

**Spec gaps found:**
- Brand logo storage (note 4).
- Filtering images by review status (note 5).
- The Overview hero selection and photo review counts (note 6; now U5 Task 1).
- The report config ripple through the built-in templates' catalogue seed (note 1).
