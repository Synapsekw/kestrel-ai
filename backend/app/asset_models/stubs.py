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

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
add_stubs(router, STUBS)


def stub_operation_ids() -> set[str]:
    return {name for _, _, name in STUBS}
