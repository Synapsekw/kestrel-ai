"""501 placeholders for the plant model operations (spec 2026-10-03-plant-model-generator §10, plan
2026-10-03-plant-model-f0).

F0 lands the whole contract before any unit builds it, so every new operation is routed here and
answers 501 `not_implemented` until its unit lands. Each list belongs to one unit of the index's DAG.
A unit that builds an operation deletes its tuple here and routes the real handler in its own module;
`tests/test_contract.py::EXPECTED_STUBS` reads `stub_operation_ids()`, so nothing else changes. The
last owner deletes this module, its lines in `app/api.py` and the `EXPECTED_STUBS |=` line.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

Stub = tuple[str, str, str]  # (method, path under /projects/{projectId}, operationId)

M = "/asset-models/{assetModelId}"

# A1: the register (spec §7, §9).
A1_STUBS: list[Stub] = []

# R1: plant run packages (spec §8.2).
R1_STUBS: list[Stub] = [
    ("GET", M + "/runs/{runId}/packages", "listAssetModelRunPackages"),
]

# S1: the Site 3D manifest (spec §10, §11). Built: `GET /site-scene` is routed by
# `app.asset_models.site_scene`. The empty list stays so per-unit tests can still name it.
S1_STUBS: list[Stub] = []

STUBS: list[Stub] = [*A1_STUBS, *R1_STUBS, *S1_STUBS]

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
add_stubs(router, STUBS)


def stub_operation_ids() -> set[str]:
    """Every plant model operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in STUBS}
