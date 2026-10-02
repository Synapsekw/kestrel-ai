"""501 placeholders for the run operations until U5 (Foundation's contract-first pattern).
U5 deletes this module, its line in app/api.py and the EXPECTED_STUBS line in test_contract.py."""

from fastapi import APIRouter

from app.stubs import add_stubs

M = "/asset-models/{assetModelId}/runs"
STUBS: list[tuple[str, str, str]] = [
    ("POST", M, "startAssetModelRun"),
    ("GET", M, "listAssetModelRuns"),
    ("GET", M + "/{runId}", "getAssetModelRun"),
    ("POST", M + "/{runId}/stop", "stopAssetModelRun"),
    ("GET", M + "/{runId}/steps/{step}/thumb", "getAssetModelRunThumb"),
    ("GET", M + "/{runId}/overlay/{cloudId}", "getAssetModelRunOverlay"),
]

# U3 task 3b deletes these when router.py lands (the real models and versions routes replace them).
_P = "/asset-models"
_UNTIL_ROUTER: list[tuple[str, str, str]] = [
    ("GET", _P, "listAssetModels"),
    ("POST", _P, "createAssetModel"),
    ("GET", _P + "/{assetModelId}", "getAssetModel"),
    ("PATCH", _P + "/{assetModelId}", "patchAssetModel"),
    ("DELETE", _P + "/{assetModelId}", "deleteAssetModel"),
    ("GET", _P + "/{assetModelId}/versions", "listAssetModelVersions"),
    ("POST", _P + "/{assetModelId}/versions", "createAssetModelVersion"),
    ("GET", _P + "/{assetModelId}/versions/{version}", "getAssetModelVersion"),
    ("POST", _P + "/{assetModelId}/versions/{version}/restore", "restoreAssetModelVersion"),
    ("GET", _P + "/{assetModelId}/versions/{version}/glb", "getAssetModelGlb"),
]

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
add_stubs(router, STUBS)
add_stubs(router, _UNTIL_ROUTER)


def stub_operation_ids() -> set[str]:
    return {name for _, _, name in STUBS + _UNTIL_ROUTER}
