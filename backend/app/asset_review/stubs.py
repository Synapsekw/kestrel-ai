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
D1_STUBS: list[Stub] = []

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
