# backend/tests/test_asset_findings_stubs.py
"""Asset findings C0: every new operation is routed as a 501 stub until its unit lands (plan
2026-10-03-asset-findings-c0). A unit that builds an operation deletes its tuple from
app/asset_review/stubs.py or app/brands/stubs.py, and these tests follow because they read the lists.
"""

import re

from test_asset_findings_contract import ASSET_FINDINGS_OPERATIONS
from test_contract import EXPECTED_STUBS

from app.asset_review import stubs as review_stubs
from app.brands import stubs as brand_stubs

PROJECT = "/api/v1/projects/{projectId}"
APP = "/api/v1"
UNIT_LISTS = {
    "D1": (review_stubs.D1_STUBS, PROJECT),
    "J1": (review_stubs.J1_STUBS, PROJECT),
    "J2": (review_stubs.J2_STUBS, PROJECT),
    "J3": (review_stubs.J3_STUBS, PROJECT),
    "J4": (review_stubs.J4_STUBS, PROJECT),
    "J5": (review_stubs.J5_STUBS, PROJECT),
    "D2": (brand_stubs.D2_STUBS, APP),
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _kwargs(method: str) -> dict:
    return {"json": {}} if method in ("POST", "PUT", "PATCH") else {}


def test_every_stub_is_an_asset_findings_operation_the_contract_test_expects():
    ids = review_stubs.stub_operation_ids() | brand_stubs.stub_operation_ids()
    assert ids <= set(ASSET_FINDINGS_OPERATIONS), sorted(ids - set(ASSET_FINDINGS_OPERATIONS))
    assert ids <= EXPECTED_STUBS, sorted(ids - EXPECTED_STUBS)


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, (listed, prefix) in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert ASSET_FINDINGS_OPERATIONS[op_id] == (method.lower(), prefix + path, unit), op_id


def test_the_lists_add_up():
    assert review_stubs.STUBS == [
        *review_stubs.D1_STUBS,
        *review_stubs.J1_STUBS,
        *review_stubs.J2_STUBS,
        *review_stubs.J3_STUBS,
        *review_stubs.J4_STUBS,
        *review_stubs.J5_STUBS,
    ]
    assert brand_stubs.STUBS == brand_stubs.D2_STUBS


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in review_stubs.STUBS:
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in review_stubs.STUBS:
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 404, (op_id, r.text)


def test_the_brand_stubs_answer_501(client):
    for method, path, op_id in brand_stubs.STUBS:
        r = client.request(method, f"{APP}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id
