"""Reports (spec 2026-09-26-reports section 14): one router over the per-owner route modules.

Each module belongs to one unit (index "Interface decisions"): routes_reports, routes_templates,
routes_assets and routes_open to R1, routes_outline to R2, routes_snapshots to R3, routes_versions to
R5. R0 fills each with 501 stubs; an owner rewrites its module and drops `STUBS`, and
`tests/test_contract.py::EXPECTED_STUBS` follows through `stub_operation_ids()`. `app/api.py`
includes this router in a guarded block, so a broken import costs reports, never the app.
"""

from types import ModuleType

from fastapi import APIRouter

from app.reports import (
    routes_assets,
    routes_open,
    routes_outline,
    routes_reports,
    routes_snapshots,
    routes_templates,
    routes_versions,
)

ROUTE_MODULES: tuple[ModuleType, ...] = (
    routes_reports,
    routes_templates,
    routes_assets,
    routes_open,
    routes_outline,
    routes_snapshots,
    routes_versions,
)

router = APIRouter(tags=["reports"])
for _module in ROUTE_MODULES:
    router.include_router(_module.router)


def stub_operation_ids() -> set[str]:
    """Every Reports operation still answered by a 501 stub."""
    return {op_id for module in ROUTE_MODULES for _, _, op_id in getattr(module, "STUBS", ())}
