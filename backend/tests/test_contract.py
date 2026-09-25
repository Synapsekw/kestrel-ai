"""Contract conformance: every path in contract/openapi.yaml is routed and every response validates."""

from pathlib import Path

import pytest
import schemathesis
import yaml
from hypothesis import HealthCheck, settings
from schemathesis.generation.meta import GenerationMode
from schemathesis.specs.openapi.checks import (
    allow_header_conformance,
    content_type_conformance,
    negative_data_rejection,
    positive_data_acceptance,
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


def test_refusal_allowances_name_real_operations_and_declared_statuses():
    """Every REFUSES_VALID_DATA entry is a real operationId and each status is declared for it."""
    # REFUSES_VALID_DATA is empty at F0, so this loop checks nothing; it becomes live as S1-S3 add
    # entries.
    ops = {
        op["operationId"]: op
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    for op_id, statuses in REFUSES_VALID_DATA.items():
        assert op_id in ops, op_id
        declared = {int(code) for code in ops[op_id]["responses"] if str(code).isdigit()}
        assert statuses <= declared, (op_id, sorted(statuses - declared))


def test_every_spec_path_is_routed(app):
    wanted = _operations(yaml.safe_load(SPEC.read_text("utf-8"))["paths"])
    have = _operations(app.openapi()["paths"])
    assert wanted <= have, sorted(wanted - have)


def test_no_extra_api_routes(app):
    wanted = _operations(yaml.safe_load(SPEC.read_text("utf-8"))["paths"])
    have = _operations(app.openapi()["paths"])
    assert have <= wanted, sorted(have - wanted)


schema = schemathesis.openapi.from_path(str(SPEC))

# Operations still served by 501 stubs: every operation of the point-cloud (S1), volumes (S2) and
# design-surface (S3) specs, routed by foundation F0. Each unit that builds one removes it here and
# from its router's STUBS; any other 501 fails `test_responses_conform`.
EXPECTED_STUBS: set[str] = set()

# Operations that may refuse a schema-valid request by design, because the schema cannot express
# the rule (a Range the file cannot satisfy, a point count a measurement kind does not take, an
# admission refusal, a self-crossing polygon): operationId -> the statuses such a request may get.
# For exactly those responses only schemathesis's positive-data-acceptance check is skipped; every
# conformance check still runs, and the answer must carry its own error code, never
# `validation_error` (FastAPI's malformed-request answer). This is the only allowance mechanism:
# S1, S2 and S3 add entries here and never loosen the test another way. Empty until a unit builds a
# refusing operation; each status must be declared for its operation in openapi.yaml (guarded below).
REFUSES_VALID_DATA: dict[str, set[int]] = {
    # S2 (plan deviation 14): a schema-valid build whose ids resolve can still be refused - a full
    # disk (`insufficient_disk`), a grid over the cell ceiling (`grid_too_large`), a feet-based or
    # CRS-less cloud (`unsupported_crs`), a missing source (`source_missing`), a Z clip upside down
    # (`invalid_build_request`). Never `validation_error`: F0's branch asserts that.
    "createSurface": {422},
    "getSurfaceOrthoTile": {422},  # no_coordinates: the map or the surface has no CRS
    "createVolumeMeasurement": {422},  # invalid_geometry / invalid_base
    "patchVolumeMeasurement": {422},  # invalid_geometry / invalid_base
    "getPointCloudOctreeFile": {416},  # a Range the file cannot satisfy
    "createCloudMeasurement": {422},
    "createPointCloud": {422},  # a readable path that is not LAS/LAZ, or refused by admission
    "inspectPointCloudFile": {422},  # a readable path that is not LAS/LAZ
    "patchPointCloud": {422},  # a link without overlap or coordinates, an unknown EPSG
}


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
    op_id = case.operation.definition.raw.get("operationId")
    # schemathesis also fuzzes negative (schema-invalid, e.g. a required param dropped) cases by
    # default; those legitimately hit FastAPI's own `validation_error`, so REFUSES_VALID_DATA (a
    # business-rule refusal of a *schema-valid* request) only judges positively-generated cases.
    is_positive = case.meta is None or case.meta.generation.mode == GenerationMode.POSITIVE
    if is_positive and response.status_code in REFUSES_VALID_DATA.get(op_id, set()):
        # A deliberate refusal of a schema-valid request: skip only positive-data acceptance.
        code = response.json()["error"]["code"]
        assert code and code != "validation_error", response.text
        excluded.append(positive_data_acceptance)
    case.validate_response(response, excluded_checks=excluded)
