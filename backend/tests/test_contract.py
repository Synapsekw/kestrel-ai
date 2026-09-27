"""Contract conformance: every path in contract/openapi.yaml is routed and every response validates."""

from pathlib import Path

import pytest
import schemathesis
import yaml
from hypothesis import HealthCheck, settings
from project_factory import new_project
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

from app.workspace.stubs import stub_operation_ids as workspace_stub_operation_ids

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
    """Every REFUSES_VALID_DATA entry is a real operationId; each status is also declared for its
    operation."""
    ops = {
        op["operationId"]: op
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    for op_id, statuses in REFUSES_VALID_DATA.items():
        assert op_id in ops, op_id
        declared = {int(code) for code in ops[op_id]["responses"] if str(code).isdigit()}
        declared |= UNDECLARED_REFUSALS.get(op_id, set())
        assert statuses <= declared, (op_id, sorted(statuses - declared))


def test_every_spec_path_is_routed(app):
    paths = yaml.safe_load(SPEC.read_text("utf-8"))["paths"]
    retiring = {
        (m.upper(), p)
        for p, ops in paths.items()
        for m, op in ops.items()
        if m in METHODS and op["operationId"] in RETIRING
    }
    wanted = _operations(paths) - retiring
    have = _operations(app.openapi()["paths"])
    assert wanted <= have, sorted(wanted - have)


def test_transition_allowances_name_real_operations():
    """BACKEND_PENDING and RETIRING name real operations; RETIRING ones are deprecated with that unit."""
    ops = {
        op["operationId"]: op
        for ops in yaml.safe_load(SPEC.read_text("utf-8"))["paths"].values()
        for m, op in ops.items()
        if m in METHODS
    }
    assert set(BACKEND_PENDING) <= set(ops), sorted(set(BACKEND_PENDING) - set(ops))
    assert not set(BACKEND_PENDING) & EXPECTED_STUBS, sorted(set(BACKEND_PENDING) & EXPECTED_STUBS)
    deprecated = {op_id: op.get("x-retire-with") for op_id, op in ops.items() if op.get("deprecated")}
    assert deprecated == RETIRING


def test_no_extra_api_routes(app):
    wanted = _operations(yaml.safe_load(SPEC.read_text("utf-8"))["paths"])
    have = _operations(app.openapi()["paths"])
    assert have <= wanted, sorted(have - wanted)


schema = schemathesis.openapi.from_path(str(SPEC))

# Images (plan 2026-09-27-images-c0): every I unit has landed its stubs, so none are left.
EXPECTED_STUBS: set[str] = set()
EXPECTED_STUBS |= workspace_stub_operation_ids()  # M-C0: app/workspace/stubs.py, one list per M unit

# Point cloud workspace (spec 2026-09-26-point-cloud-workspace section 12), unit C-C0: the tuples of
# app/pointclouds/router.py::STUBS. C-B2, C-B3 and C-B4 have all landed and deleted their own names
# here and in app/pointclouds/router.py::STUBS; the block is empty.

# Operations whose contract is ahead of the backend after foundation unit C0: the contract dropped
# the project kind and added `Project.summary`/`migration`, `ClassDef.kind`/`default_severity`/
# `group` and `LibraryModel.class_map`, which the backend fills only when the named units land.
# For these the request must still not crash (< 500); conformance is checked again once the entry
# is gone. The unit that lands last for an entry deletes it.
BACKEND_PENDING: dict[str, str] = {
    # Images I-C0 (plan 2026-09-27-images-c0): kept operations whose responses gained required
    # fields. Each unit deletes its lines once its routes fill them.
    # The route is gone (I-BP); the deprecated path stays until I-FW deletes it with its last
    # frontend helper, so the operation only has to answer < 500 (a 404) until then.
    "preannotateImage": "I-FW",
}


# Deprecated operations (`deprecated: true`, `x-retire-with`) that leave the contract with their
# last frontend caller, in the named unit. A backend unit may delete such a route earlier (spec
# §6.1, §12): `test_every_spec_path_is_routed` does not require it. The unit that deletes the path
# from openapi.yaml deletes the entry.
RETIRING: dict[str, str] = {
    # Images: replaced by detectImage; the old editor calls it until I-FW deletes editor/*.
    "preannotateImage": "I-FW",
}

# Operations that may refuse a schema-valid request by design, because the schema cannot express
# the rule (a Range the file cannot satisfy, a point count a measurement kind does not take, an
# admission refusal, a self-crossing polygon): operationId -> the statuses such a request may get.
# For exactly those responses only schemathesis's positive-data-acceptance check is skipped; every
# conformance check still runs, and the answer must carry its own error code, never
# `validation_error` (FastAPI's malformed-request answer). This is the only allowance mechanism:
# S1, S2 and S3 add entries here and never loosen the test another way; each status must be
# declared for its operation in openapi.yaml (guarded below).
REFUSES_VALID_DATA: dict[str, set[int]] = {
    # S2 (plan deviation 14): a schema-valid build whose ids resolve can still be refused - a full
    # disk (`insufficient_disk`), a grid over the cell ceiling (`grid_too_large`), a feet-based or
    # CRS-less cloud (`unsupported_crs`), a missing source (`source_missing`), a Z clip upside down
    # (`invalid_build_request`). Never `validation_error`: F0's branch asserts that.
    "putLibraryModelClassMap": {422},  # unknown_type (bad/archived type id) or validation_error (bad key)
    "createLibraryDataset": {409},  # conflict: a whitespace-only name (minLength cannot say "not blank")
    "exportLibraryDataset": {422},  # declared; no longer answered since I-BT (segment exports)
    "startTrainingRun": {422},  # task_mismatch: a base model of another task
    "createSurface": {422},
    # M-B2: a schema-valid path that is not a usable elevation file (`source_missing`,
    # `not_elevation`, `no_coordinates`, `geographic_output`, `non_metric_output`, `no_overlap`,
    # `grid_too_large`, `insufficient_disk`).
    "importElevation": {422},
    "getSurfaceOrthoTile": {422},  # no_coordinates: the map or the surface has no CRS
    "createVolumeMeasurement": {422},  # invalid_geometry / invalid_base
    "patchVolumeMeasurement": {422},  # invalid_geometry / invalid_base
    "getPointCloudOctreeFile": {416},  # a Range the file cannot satisfy
    "createCloudMeasurement": {422},
    "updateCloudMeasurement": {422},  # C-B1: a generated finding_id is never a finding on that cloud
    "createPointCloud": {422},  # a readable path that is not LAS/LAZ, or refused by admission
    "inspectPointCloudFile": {422},  # a readable path that is not LAS/LAZ
    "patchPointCloud": {422},  # a link without overlap or coordinates, an unknown EPSG
    # Foundation unit BM (task 10b, contract follow-up I2): a cross-field either/or the schema does
    # not express (unlike `SurfaceBuildRequest.name`'s `minLength`, this is not a single-field
    # constraint).
    "createRuns": {422},  # model_or_provider_required / query_required
    "createSiteArea": {422},  # invalid_outline: the polygon_wgs84 / map_id+polygon_px shape rule
    "updateSiteArea": {422},  # invalid_outline: the polygon_wgs84 / map_id+polygon_px shape rule
    # BC: a schema-valid but non-contiguous or too-long severity scale (`invalid_scale`), or a
    # schema-valid `default_severity` that names a level above the live scale (`severity_unknown`,
    # spec section 15). createCatalogueType/patchCatalogueType are also in UNDECLARED_REFUSALS below:
    # the contract does not declare a 422 response for either (only 201/409/503 and
    # 200/404/409/503), a gap BC records rather than fixes (global constraints: "BC does not edit
    # contract/") - see the task-4 report.
    "createCatalogueType": {422},
    "patchCatalogueType": {422},
    "putSeverityScale": {422},
    # BC: a generated type id the catalogue does not know (`unknown_type`).
    "putProjectTypes": {422},
    # BK/BC: a project created with generated `type_ids` the catalogue does not know
    # (`unknown_type`). Masked by BACKEND_PENDING until BC task 13; the contract declares no 422
    # for createProject (UNDECLARED_REFUSALS below) - recorded in BC's task-13 report.
    "createProject": {422},
    # BC: generated type ids are unknown (`unknown_type`), a level above the scale
    # (`severity_unknown`), a generated geometry that is not a closed ring (`invalid_geometry`),
    # a patch of an image anchor (`anchor_immutable`).
    "createFinding": {422},
    "patchFinding": {422},
    # BC: a generated path is never a readable photo (`attachment_invalid`, details {reason}).
    "addFindingAttachment": {422},
    # BC: a generated type that exists but is an object type (`not_a_defect`).
    "backfillCatalogueType": {422},
    # M-B4: a fresh contract-test project has no `map_workspace` row (`no_site_frame`, 409); schema-
    # valid vertices can still be degenerate (`invalid_geometry`); a surface list can break the
    # per-kind count (`invalid_surfaces`) or sit in the other frame (`surface_not_in_frame`); a line
    # can miss every surface (`no_surface_under_line`); a local row read in a CRS frame is
    # `not_in_site_frame` (409).
    "listMapMeasurements": {409},
    "getMapMeasurement": {409},
    "createMapMeasurement": {409, 422},
    "patchMapMeasurement": {409, 422},
    # I-BS: a generated acquire can land while the previous one is still live (`job_running`).
    "acquireAssistModel": {409},
    # C-B4 (spec 2026-09-26-point-cloud-workspace section 11.4): a schema-valid multipart whose image
    # is not a 1600 x 1000 PNG/JPEG (`bad_view_image`), or a finding anchored on an image or a map
    # (`not_a_cloud_finding`). Generated ids resolve to 404 first, so these are rare.
    "putFindingView3d": {409, 422},
    "putCloudMeasurementView3d": {422},
    # M-B3 drawings: `pdf_unavailable`; DWG/extension refusals are `validation_error` and only
    # reachable with a real file.
    "createDrawingInspection": {422},
    "putDrawingGeoref": {422},  # generated points can be mirrored, collinear or coincident
    "fitDrawingGeoref": {422},
    "getDrawingVectorTile": {422},  # a generated t is invalid_preview
    # M-B1: a schema-valid EPSG pyproj does not know (`invalid_epsg`) or that is not a projected
    # metre CRS (`needs_projected_crs`); a schema-valid state over 64 KB (`state_too_large`); an
    # anchor on a map without CRS, in a local frame or off the map (`no_coordinates`, `local_frame`,
    # `outside_map`); a tile of a layer outside the frame (`no_coordinates`) or a malformed preview
    # affine `t` (`invalid_preview`).
    "setSiteFrame": {422},
    "putMapWorkspace": {422},
    "convertAnchor": {422},
    "getSiteTile": {422},
    # I-BP: a generated model id may exist but have no weights (`model_unavailable` 409) or no class
    # that reaches a catalogue type (`unmapped_classes` 422).
    "detectImage": {409, 422},
    # I-BP: a scope matching no image (`no_images`), a kind without its model/provider
    # (`model_or_provider_required`), a blank cloud query (`query_required`), no class mapped
    # (`unmapped_classes`), no stored key (`conflict` 409) or missing weights (`model_unavailable`).
    "detectImageBatch": {409, 422},
}

# A REFUSES_VALID_DATA status the contract does not declare for that operation (a real gap in
# openapi.yaml, not a typo here): operationId -> the undeclared statuses, checked against the live
# HTTP behaviour by test_responses_conform regardless. Empty until BC's task 4; see its report.
UNDECLARED_REFUSALS: dict[str, set[int]] = {
    "createCatalogueType": {422},
    "patchCatalogueType": {422},
    "createProject": {422},
}


@pytest.fixture
def project_id(client, project_dir) -> str:
    return new_project(client, project_dir, name="A", classes=[{"name": "excavator", "colour": "#ff0000"}])[
        "id"
    ]


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
    op_id = case.operation.definition.raw.get("operationId")
    if op_id in BACKEND_PENDING:
        # The contract is ahead of the backend until BACKEND_PENDING[op_id] lands.
        assert response.status_code < 500, response.text
        return
    is_stub = response.status_code == 501 and response.json()["error"]["code"] == "not_implemented"
    if is_stub and case.method.upper() != case.operation.method.upper():
        # unsupported_method's own negative case: a literal path shares a prefix with a sibling
        # parameter path, so a mismatched method can land on one of that sibling's still-stubbed
        # operations rather than a 405. Only the request's own method is checked against
        # EXPECTED_STUBS; a wrong-method answer from a real route is validated below as usual.
        return
    if is_stub:
        # A stub: the operation is routed but not built yet; it must still answer in the error envelope.
        assert op_id in EXPECTED_STUBS, f"unexpected stub for {op_id}"
        checks = [response_schema_conformance, content_type_conformance, status_code_conformance]
        case.validate_response(response, checks=checks)
        return
    assert response.status_code < 500, response.text
    # negative_data_rejection: FastAPI ignores unknown query parameters by design.
    # unsupported_method / allow_header_conformance: literal segments such as /projects/open share
    # a prefix with /projects/{projectId}, so Starlette answers for the union of both routes.
    excluded = [negative_data_rejection, unsupported_method, allow_header_conformance]
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
