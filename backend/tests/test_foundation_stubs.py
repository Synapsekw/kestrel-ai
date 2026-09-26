"""Foundation unit C0: every new foundation operation is routed and answers 501 until its unit lands.

The checks read `app.foundation_stubs`, so the backend units never edit this file: a unit that builds
an operation deletes its tuple there and this test follows.
"""

import re

import yaml
from test_contract import METHODS, SPEC

from app import foundation_stubs


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _call(client, method: str, url: str):
    body = {} if method in ("POST", "PUT", "PATCH") else None
    return client.request(method, url, json=body)


def test_every_project_stub_answers_501_on_a_real_project(client, project_id):
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        r = _call(client, method, f"/api/v1/projects/{project_id}{_concrete(path)}")
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_a_project_stub_answers_404_for_an_unknown_project(client):
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        r = _call(client, method, f"/api/v1/projects/nope{_concrete(path)}")
        assert r.status_code == 404, (op_id, r.text)


def test_every_app_stub_answers_501(client):
    for method, path, op_id in foundation_stubs.APP_STUBS:
        r = _call(client, method, f"/api/v1{_concrete(path)}")
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented"


def test_every_stub_is_a_contract_operation_at_its_path():
    contract = {
        op["operationId"]: (method.upper(), path)
        for path, ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }
    for method, path, op_id in foundation_stubs.PROJECT_STUBS:
        assert contract.get(op_id) == (method, f"/api/v1/projects/{{projectId}}{path}"), op_id
    for method, path, op_id in foundation_stubs.APP_STUBS:
        assert contract.get(op_id) == (method, f"/api/v1{path}"), op_id
