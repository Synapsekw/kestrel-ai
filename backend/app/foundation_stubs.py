"""501 placeholders for the foundation's new operations (spec 2026-09-26-foundation-design §13).

Unit C0 lands the whole foundation contract before any backend unit builds it, so every new
operation is routed here and answers 501 `not_implemented` until its unit lands. Each list belongs
to one unit of the foundation DAG (§18). A unit that builds an operation deletes its tuple here and
routes the real handler in its own module; `tests/test_contract.py::EXPECTED_STUBS` is derived from
these lists, so nothing else needs editing. When a list is empty its unit deletes it, and the last
unit to land deletes this module and its `include_router` lines in `app/api.py`.

Project-scoped paths are relative to `/projects/{projectId}` and resolve the project first (404 for
an unknown project). Within a list, a literal path precedes a parameter path of the same method
(`/findings/summary` before `/findings/{findingId}`), because routes match in order.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

# (method, path, operationId)
Stub = tuple[str, str, str]

# BM: datasets across projects, training runs and the model class map (§12, §7.4).
BM_APP_STUBS: list[Stub] = [
    ("GET", "/library/training-runs", "listTrainingRuns"),
    ("POST", "/library/training-runs", "startTrainingRun"),
    ("GET", "/library/training-runs/{runId}", "getTrainingRun"),
]

# Every project-scoped foundation operation is built; the router stays for the machinery.
PROJECT_STUBS: list[Stub] = []
APP_STUBS: list[Stub] = [*BM_APP_STUBS]

project_router = APIRouter(prefix="/projects/{projectId}", tags=["foundation-stubs"])
add_stubs(project_router, PROJECT_STUBS)
app_router = APIRouter(tags=["foundation-stubs"])
add_stubs(app_router, APP_STUBS, project_scoped=False)


def stub_operation_ids() -> set[str]:
    """Every operation still answered by a foundation 501 stub."""
    return {op_id for _, _, op_id in (*PROJECT_STUBS, *APP_STUBS)}
