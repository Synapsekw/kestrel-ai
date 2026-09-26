"""Foundation unit C0: contract/openapi.yaml carries every path and schema of foundation spec §13.

The spec is docs/superpowers/specs/2026-09-26-foundation-design.md. These tests read only the YAML;
`test_contract.py` checks that the backend routes it and `pnpm -C contract check` lints it.
"""

from pathlib import Path

import pytest
import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")

P = "/api/v1/projects/{projectId}"
F = P + "/findings/{findingId}"

# operationId -> (method, path) of every operation the foundation adds.
FOUNDATION_OPERATIONS: dict[str, tuple[str, str]] = {
    # projects (Task 1)
    "retryProjectMigration": ("post", "/api/v1/projects/migrations/retry"),
    "revealProjectBackup": ("post", "/api/v1/projects/migrations/reveal-backup"),
    "putProjectTypes": ("put", P + "/types"),
    # catalogue (Task 3)
    "listCatalogueTypes": ("get", "/api/v1/catalogue/types"),
    "createCatalogueType": ("post", "/api/v1/catalogue/types"),
    "getCatalogueType": ("get", "/api/v1/catalogue/types/{typeId}"),
    "patchCatalogueType": ("patch", "/api/v1/catalogue/types/{typeId}"),
    "backfillCatalogueType": ("post", "/api/v1/catalogue/types/{typeId}/backfill"),
    "getSeverityScale": ("get", "/api/v1/catalogue/severity"),
    "putSeverityScale": ("put", "/api/v1/catalogue/severity"),
    "completeCatalogueClassification": ("post", "/api/v1/catalogue/classification/done"),
    "getOperatorSettings": ("get", "/api/v1/settings/operator"),
    "putOperatorSettings": ("put", "/api/v1/settings/operator"),
    # findings (Task 4)
    "listFindings": ("get", P + "/findings"),
    "createFinding": ("post", P + "/findings"),
    "getFindingSummary": ("get", P + "/findings/summary"),
    "bulkUpdateFindings": ("post", P + "/findings/bulk"),
    "recountFindings": ("post", P + "/findings/recount"),
    "getFinding": ("get", F),
    "patchFinding": ("patch", F),
    "deleteFinding": ("delete", F),
    "getFindingThumbnail": ("get", F + "/thumbnail"),
    "listFindingComments": ("get", F + "/comments"),
    "createFindingComment": ("post", F + "/comments"),
    "patchFindingComment": ("patch", F + "/comments/{commentId}"),
    "deleteFindingComment": ("delete", F + "/comments/{commentId}"),
    "listFindingAttachments": ("get", F + "/attachments"),
    "addFindingAttachment": ("post", F + "/attachments"),
    "deleteFindingAttachment": ("delete", F + "/attachments/{attachmentId}"),
    "getFindingAttachmentFile": ("get", F + "/attachments/{attachmentId}/file"),
    "getFindingAttachmentThumbnail": ("get", F + "/attachments/{attachmentId}/thumbnail"),
}

# Response schemas the Prism mock serves: each carries its own example (spec §18 "Prism examples").
EXAMPLED_SCHEMAS = [
    "Project",
    "ProjectSummary",
    "MigrationState",
    "ClassDef",
    "CatalogueType",
    "CatalogueTypePage",
    "CatalogueTypeUpdated",
    "SeverityScale",
    "OperatorSettings",
    "Finding",
    "FindingDetail",
    "FindingPage",
    "FindingSummary",
    "FindingComment",
    "FindingCommentPage",
    "FindingAttachment",
    "FindingAttachmentList",
]


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def _schemas(spec: dict) -> dict:
    return spec["components"]["schemas"]


def _operations(spec: dict) -> dict[str, tuple[str, str, dict]]:
    return {
        op["operationId"]: (method, path, op)
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }


# ------------------------------------------------------------------------------ Task 1


def test_no_project_kind_is_left():
    text = SPEC.read_text("utf-8")
    for word in ("ProjectKind", "wrong_project_kind", "training project", "detection project"):
        assert word not in text, word


def test_a_project_has_no_kind_but_a_summary_and_a_migration_state(spec):
    project = _schemas(spec)["Project"]
    assert "kind" not in project["properties"]
    assert {"summary", "migration", "last_opened_at", "availability"} <= set(project["required"])
    assert project["properties"]["availability"] == {"$ref": "#/components/schemas/ProjectAvailability"}
    assert _schemas(spec)["ProjectAvailability"]["enum"] == ["ok", "missing"]
    assert project["properties"]["migration"] == {"$ref": "#/components/schemas/MigrationState"}
    states = _schemas(spec)["MigrationState"]["properties"]["state"]["enum"]
    assert states == ["ok", "pending", "running", "failed"]
    assert _schemas(spec)["MigrationState"]["required"] == ["state"]  # MG may leave the rest out


def test_a_project_is_created_with_catalogue_type_ids(spec):
    create = _schemas(spec)["ProjectCreate"]
    assert create["required"] == ["name", "folder"]  # `type_ids` is empty when absent (BK)
    assert set(create["properties"]) == {"name", "folder", "type_ids"}
    assert "additionalProperties" not in create  # the kind shim's extra fields must stay accepted


def test_a_class_def_is_a_catalogue_type_snapshot(spec):
    class_def = _schemas(spec)["ClassDef"]
    assert {"kind", "default_severity", "group"} <= set(class_def["required"])
    assert _schemas(spec)["CatalogueKind"]["enum"] == ["defect", "object"]


def test_the_new_job_types_and_events(spec):
    job_types = _schemas(spec)["JobType"]["enum"]
    for job_type in ("project_migrate", "findings_backfill", "findings_recount", "dataset_build", "map_move"):
        assert job_type in job_types
    events = _schemas(spec)["Event"]["properties"]["type"]["enum"]
    for event in ("findings.changed", "data.changed", "catalogue.changed", "migration.changed"):
        assert event in events


def test_the_replaced_operations_are_deprecated_with_the_unit_that_removes_them(spec):
    ops = _operations(spec).items()
    retired = {op_id: op.get("x-retire-with") for op_id, (_, _, op) in ops if op.get("deprecated")}
    assert retired == {
        "updateClasses": "F-S2",
        "listDatasets": "F-S2",
        "createDataset": "F-S2",
        "getDataset": "F-S2",
        "deleteDataset": "F-S2",
        "getDatasetStats": "F-S2",
        "trainModel": "F-S2",
        "moveMapToProject": "F-SH",
    }


# ------------------------------------------------------------------------------ every task


@pytest.mark.parametrize("op_id", sorted(FOUNDATION_OPERATIONS))
def test_the_foundation_operation_exists(spec, op_id):
    ops = _operations(spec)
    assert op_id in ops, op_id
    method, path, op = ops[op_id]
    assert (method, path) == FOUNDATION_OPERATIONS[op_id]
    assert "default" in op["responses"], "every operation answers errors in the envelope"


@pytest.mark.parametrize("name", EXAMPLED_SCHEMAS)
def test_the_mock_has_an_example(spec, name):
    assert name in _schemas(spec), name
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    if name.endswith("Page"):
        # A generated cursor would be the string "string": a client paging the mock never stops.
        assert example["next_cursor"] is None, name


# ------------------------------------------------------------------------------ Task 3


def test_the_severity_scale_has_at_most_nine_levels(spec):
    scale = _schemas(spec)["SeverityScale"]["properties"]["levels"]
    assert (scale["minItems"], scale["maxItems"]) == (1, 9)
    assert [lvl["name"] for lvl in _schemas(spec)["SeverityScale"]["example"]["levels"]] == [
        "Minor",
        "Moderate",
        "Major",
        "Critical",
    ]


# ------------------------------------------------------------------------------ Task 4


def test_a_finding_anchor_is_one_of_three_kinds(spec):
    anchor = _schemas(spec)["FindingAnchor"]
    assert anchor["discriminator"]["propertyName"] == "kind"
    assert set(anchor["discriminator"]["mapping"]) == {"image", "map", "cloud"}
    cloud = _schemas(spec)["FindingCloudAnchor"]["properties"]
    assert set(cloud) == {"kind", "cloud_id", "x", "y", "z", "uncertainty_m"}  # C10: no normal here


def test_the_findings_list_filters_by_image_and_pages_at_500(spec):
    _, _, op = _operations(spec)["listFindings"]
    names = {p.get("name") for p in op["parameters"] if "name" in p}
    assert {"status", "severity", "type_id", "anchor_kind", "data_id", "image_id", "q", "sort"} <= names
    assert {"$ref": "#/components/parameters/findingsLimit"} in op["parameters"]
    assert spec["components"]["parameters"]["findingsLimit"]["schema"]["maximum"] == 500


def test_a_box_reclass_that_would_delete_a_finding_needs_confirmation(spec):
    _, _, op = _operations(spec)["updateBox"]
    assert any(p.get("name") == "confirm_finding_delete" for p in op["parameters"])
    assert "409" in op["responses"]
