"""Images (sub-project I): the aggregator for the per-unit route modules (plan 2026-09-27-images-c0).

I-C0 routes every new operation as a 501 stub in the module of the unit that builds it; that unit
replaces its module's stubs and deletes their EXPECTED_STUBS entries in tests/test_contract.py. Each
module is imported under its own guard, so one that fails to import costs only its own endpoints
(AGENTS.md: the app must start even when startup work fails). `routes_index` comes first:
`/images/index` must not reach an `/images/{imageId}` route.
"""

import importlib
import logging

from fastapi import APIRouter

log = logging.getLogger(__name__)

ROUTE_MODULES = (
    "app.imagery.routes_index",
    "app.imagery.routes_camera",
    "app.imagery.routes_boxes",
    "app.imagery.routes_detect",
)

router = APIRouter()
for _module in ROUTE_MODULES:
    try:
        router.include_router(importlib.import_module(_module).router)
    except Exception:
        log.exception("%s failed to load; its endpoints will be unavailable", _module)
