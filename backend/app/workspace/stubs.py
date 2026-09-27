"""501 placeholders for the map workspace's operations (spec 2026-09-26-map-workspace §12, M-C0).

M-C0 lands the whole contract before any M backend unit builds it, so every new operation is routed
here and answers 501 `not_implemented` until its unit lands (Foundation's pattern, ADR
2026-09-26-foundation-contract-lands-before-its-backend). Each list belongs to one unit of M's DAG
(spec §17). A unit that builds an operation deletes its tuple here and routes the real handler in
its own module (added to the `for _module in (...)` tuple at the end of `app/api.py`);
`tests/test_contract.py::EXPECTED_STUBS` is derived from `stub_operation_ids()`, so nothing else
needs editing. The last of M-B1..M-B4 to land deletes this module, its entry in that tuple, and the
`EXPECTED_STUBS |=` line with its import.

Paths are relative to `/projects/{projectId}` and resolve the project first (404 for an unknown
project). Path-parameter names are the contract's: `test_every_spec_path_is_routed` compares path
strings.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

# (method, path, operationId)
Stub = tuple[str, str, str]

# M-B1: the site frame, the workspace state, surveys, layers, site tiles, anchors, findings in view
# and the readout sample (spec §5.2, §6, §9.4).
B1_STUBS: list[Stub] = []

# M-B3: drawings - inspect, build, georeference, tiles (spec §8).
B3_STUBS: list[Stub] = []

# M-B4: map measurements and the project-wide measurements union (spec §9.1, §9.2, §4 item 8).
# All six operations are routed for real now (app/mapmeasure/router.py, app/measurements/union.py).
B4_STUBS: list[Stub] = []

STUBS: list[Stub] = [*B1_STUBS, *B3_STUBS, *B4_STUBS]

router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])
add_stubs(router, STUBS)


def stub_operation_ids() -> set[str]:
    """Every map-workspace operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in STUBS}
