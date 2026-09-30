"""R0: every Reports operation is routed as a 501 stub in its owner's module until that unit lands.

An owner rewrites its `routes_*.py`, drops `STUBS`, and these tests follow because they read the
lists (plan 2026-09-30-reports-r0 Ruling 1)."""

import re

from test_contract import EXPECTED_STUBS
from test_reports_contract import REPORT_OPERATIONS

from app.reports import router as reports_router
from app.reports import (
    routes_assets,
    routes_open,
    routes_outline,
    routes_reports,
    routes_snapshots,
    routes_templates,
    routes_versions,
)

OWNER = {
    routes_reports: "R1",
    routes_templates: "R1",
    routes_assets: "R1",
    routes_open: "R1",
    routes_outline: "R2",
    routes_snapshots: "R3",
    routes_versions: "R5",
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _stubs():
    for module in reports_router.ROUTE_MODULES:
        prefix = "/api/v1" + module.router.prefix
        for method, path, op_id in getattr(module, "STUBS", ()):
            yield module, method, prefix + path, op_id


def test_every_route_module_is_included_once():
    assert set(reports_router.ROUTE_MODULES) == set(OWNER)
    assert len(reports_router.ROUTE_MODULES) == len(OWNER)


def test_each_stub_sits_in_its_owners_module_with_the_contract_path():
    for module, method, path, op_id in _stubs():
        assert REPORT_OPERATIONS[op_id] == (method.lower(), path, OWNER[module]), op_id


def test_expected_stubs_are_exactly_the_reports_stub_lists():
    ours = set(REPORT_OPERATIONS)
    stubbed = reports_router.stub_operation_ids()
    assert stubbed <= ours
    assert EXPECTED_STUBS & ours == stubbed


def test_a_project_reaches_the_501_stubs(client, project_id):
    for _, method, path, op_id in _stubs():
        if "{projectId}" not in path:
            continue
        url = _concrete(path.replace("{projectId}", project_id))
        kwargs = {"json": {}} if method in ("POST", "PATCH") else {}
        r = client.request(method, url, **kwargs)
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_an_unknown_project_is_404_before_any_stub(client):
    for _, method, path, op_id in _stubs():
        if "{projectId}" not in path:
            continue
        kwargs = {"json": {}} if method in ("POST", "PATCH") else {}
        r = client.request(method, _concrete(path.replace("{projectId}", "nope")), **kwargs)
        assert r.status_code == 404, (op_id, r.text)


def test_the_app_wide_template_stubs_answer_501(client):
    for _, method, path, op_id in _stubs():
        if "{projectId}" in path:
            continue
        kwargs = {"json": {}} if method in ("POST", "PATCH") else {}
        r = client.request(method, _concrete(path), **kwargs)
        assert (r.status_code, r.json()["error"]["code"]) == (501, "not_implemented"), op_id
