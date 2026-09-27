"""M-C0: the map-workspace operations are routed as 501 stubs until their unit lands.

A unit that builds an operation deletes its tuple from `app/workspace/stubs.py` (and its route
goes live), and these tests follow because they read the lists. M-B5 deletes the option-guard
tests at the end of this file together with the guards in `app/workspace/pending.py`.
"""

import re

import yaml
from test_contract import EXPECTED_STUBS, METHODS, SPEC
from test_workspace_contract import WORKSPACE_OPERATIONS

from app.workspace import stubs

UNIT_LISTS = {
    "M-B1": stubs.B1_STUBS,
    "M-B2": stubs.B2_STUBS,
    "M-B3": stubs.B3_STUBS,
    "M-B4": stubs.B4_STUBS,
}


def _workspace_ops() -> set[str]:
    spec = yaml.safe_load(SPEC.read_text("utf-8"))
    return {
        op["operationId"]
        for ops in spec["paths"].values()
        for m, op in ops.items()
        if m in METHODS and "workspace" in op.get("tags", [])
    }


def test_expected_stubs_match_the_workspace_stub_lists():
    ours = _workspace_ops()
    routed = stubs.stub_operation_ids()
    assert routed <= ours, sorted(routed - ours)
    assert EXPECTED_STUBS & ours == routed, {
        "expected but not a stub": sorted((EXPECTED_STUBS & ours) - routed),
        "a stub but not expected": sorted(routed - EXPECTED_STUBS),
    }


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, listed in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert WORKSPACE_OPERATIONS[op_id] == (
                method.lower(),
                "/api/v1/projects/{projectId}" + path,
                unit,
            )


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in stubs.STUBS:
        kwargs = {"json": {}} if method in ("POST", "PUT", "PATCH") else {}
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **kwargs)
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in stubs.STUBS:
        kwargs = {"json": {}} if method in ("POST", "PUT", "PATCH") else {}
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **kwargs)
        assert r.status_code == 404, (op_id, r.text)
