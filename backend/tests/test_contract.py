"""Contract conformance: every path in contract/openapi.yaml is routed and every response validates."""

from pathlib import Path

import pytest
import schemathesis
import yaml
from hypothesis import HealthCheck, settings
from schemathesis.specs.openapi.checks import (
    allow_header_conformance,
    content_type_conformance,
    negative_data_rejection,
    response_schema_conformance,
    status_code_conformance,
    unsupported_method,
)

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
AUTH = {"Authorization": "Bearer test-token"}


def _operations(paths: dict) -> set[tuple[str, str]]:
    return {(m.upper(), p) for p, ops in paths.items() for m in ops if m in METHODS}


def test_stub_list_matches_routers(app):
    """Every EXPECTED_STUBS entry is a real operationId, so the set cannot drift from the contract."""
    ids = {
        op["operationId"]
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    assert EXPECTED_STUBS <= ids, sorted(EXPECTED_STUBS - ids)


def test_every_spec_path_is_routed(app):
    wanted = _operations(yaml.safe_load(SPEC.read_text("utf-8"))["paths"])
    have = _operations(app.openapi()["paths"])
    assert wanted <= have, sorted(wanted - have)


def test_no_extra_api_routes(app):
    wanted = _operations(yaml.safe_load(SPEC.read_text("utf-8"))["paths"])
    have = _operations(app.openapi()["paths"])
    assert have <= wanted, sorted(have - wanted)


schema = schemathesis.openapi.from_path(str(SPEC))

# Operations still served by 501 stubs (app/api.py); any other 501 fails `test_responses_conform`.
# Unit BM (plan 2026-09-23) builds these and empties the set again.
EXPECTED_STUBS: set[str] = {"getModelAdoption", "retryModelAdoption", "moveMapToProject"}


@pytest.fixture
def project_id(client, project_dir) -> str:
    body = {
        "name": "A",
        "folder": str(project_dir),
        "classes": [{"name": "excavator", "colour": "#ff0000"}],
        "kind": "train",
    }
    return client.post("/api/v1/projects", json=body).json()["id"]


@schema.parametrize()
@settings(max_examples=3, deadline=None, suppress_health_check=list(HealthCheck))
def test_responses_conform(case, app, project_id, tmp_path):
    if "projectId" in (case.path_parameters or {}):
        case.path_parameters["projectId"] = project_id
    if isinstance(case.body, dict) and "folder" in case.body:
        # Never let generated data create folders outside the test's temp dir.
        case.body["folder"] = str(tmp_path / "generated")
    if isinstance(case.query, dict) and "cursor" in case.query:
        # Cursors are opaque; a generated string is a malformed cursor (422 by design, tested in test_jobs).
        del case.query["cursor"]
    case.operation.schema.app = app  # in-process ASGI transport, no sockets
    case.operation.app = app
    response = case.call(headers=AUTH)
    if response.status_code == 501 and response.json()["error"]["code"] == "not_implemented":
        # S0 stub: the operation is routed but not built yet; it must still answer in the error envelope.
        op_id = case.operation.definition.raw.get("operationId")
        assert op_id in EXPECTED_STUBS, f"unexpected stub for {op_id}"
        checks = [response_schema_conformance, content_type_conformance, status_code_conformance]
        case.validate_response(response, checks=checks)
        return
    assert response.status_code < 500, response.text
    # negative_data_rejection: FastAPI ignores unknown query parameters by design.
    # unsupported_method / allow_header_conformance: literal segments such as /projects/open share
    # a prefix with /projects/{projectId}, so Starlette answers for the union of both routes.
    excluded = [negative_data_rejection, unsupported_method, allow_header_conformance]
    case.validate_response(response, excluded_checks=excluded)
