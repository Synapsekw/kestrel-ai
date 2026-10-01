"""S1-U1: every project-setup operation is routed as a 501 stub in its owner's module until that
unit lands (plan 2026-09-30-setup-u1, the Reports R0 pattern). An owner rewrites its module and
drops `STUBS`, and these tests follow because they read the lists."""

import re

from test_contract import EXPECTED_STUBS
from test_setup_contract import SETUP_OPERATIONS

from app.catalogue import router as catalogue_router
from app.setup import router as setup_router
from app.setup import routes_inspect, routes_templates

OWNER = {routes_templates: "U2", routes_inspect: "U3", catalogue_router: "U2"}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _stubs():
    for module in (*setup_router.ROUTE_MODULES, catalogue_router):
        prefix = "/api/v1" + module.router.prefix
        for method, path, op_id in getattr(module, "STUBS", ()):
            yield module, method, prefix + path, op_id


def test_every_route_module_is_included_once():
    assert setup_router.ROUTE_MODULES == (routes_templates, routes_inspect)


def test_each_stub_sits_in_its_owners_module_with_the_contract_path():
    for module, method, path, op_id in _stubs():
        want_method, want_path, _, owner = SETUP_OPERATIONS[op_id]
        assert (want_method, want_path, owner) == (method.lower(), path, OWNER[module]), op_id


def test_expected_stubs_are_exactly_the_setup_stub_lists():
    ours = set(SETUP_OPERATIONS)
    stubbed = setup_router.stub_operation_ids()
    assert stubbed <= ours
    assert EXPECTED_STUBS & ours == stubbed


def test_the_stubs_answer_501(client):
    for _, method, path, op_id in _stubs():
        kwargs = {"json": {}} if method in ("POST", "PATCH") else {}
        r = client.request(method, _concrete(path), **kwargs)
        assert (r.status_code, r.json()["error"]["code"]) == (501, "not_implemented"), op_id
