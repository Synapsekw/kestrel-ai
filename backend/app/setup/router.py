"""Project setup (spec 2026-09-30-project-setup section 9): one router over the per-owner route
modules.

`routes_templates` belongs to U2, `routes_inspect` to U3 (index "Interface decisions"). U1 fills
each with 501 stubs; an owner rewrites its module and drops `STUBS`, and
`tests/test_contract.py::EXPECTED_STUBS` follows through `stub_operation_ids()`. `app/api.py`
includes this router in a guarded block, so a broken import costs the setup endpoints, never the
app.
"""

from types import ModuleType

from fastapi import APIRouter

from app.catalogue import router as catalogue_routes
from app.setup import routes_inspect, routes_templates

ROUTE_MODULES: tuple[ModuleType, ...] = (routes_templates, routes_inspect)

router = APIRouter(tags=["setup"])
for _module in ROUTE_MODULES:
    router.include_router(_module.router)


def stub_operation_ids() -> set[str]:
    """Every S1 operation still answered by a 501 stub."""
    modules = (*ROUTE_MODULES, catalogue_routes)
    return {op_id for module in modules for _, _, op_id in getattr(module, "STUBS", ())}
