"""Unit R0: contract/openapi.yaml carries every Reports schema and path (spec 2026-09-26-reports
section 14), app/reports/schemas.py mirrors it one-to-one, and the shared fixture document is valid
on both sides."""

import json
from pathlib import Path
from typing import get_args

import jsonschema_rs
import pytest
import yaml
from pydantic import BaseModel

from app.reports import schemas

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "contract" / "openapi.yaml"
FIXTURE = ROOT / "contract" / "fixtures" / "report-document.json"
METHODS = ("get", "post", "put", "patch", "delete")

# Unions and enums: contract schemas with no pydantic class of their own.
UNIONS = {
    "SectionKey",
    "ReportVersionState",
    "ReportFileKind",
    "ReportSection",
    "SnapshotSpec",
    "PairSideSpec",
    "Block",
    "TableCell",
}
# Request bodies: only their required keys are required.
REQUESTS = {
    "ReportCreate",
    "ReportPatch",
    "ReportVersionPatch",
    "RenderRequest",
    "ReportTemplateCreate",
    "ReportTemplatePatch",
    "ReportAssetCreate",
}
MODELS = {
    name: obj
    for name, obj in vars(schemas).items()
    if isinstance(obj, type)
    and issubclass(obj, BaseModel)
    and obj.__module__ == schemas.__name__
    and not name.startswith("_")
}
REPORT_SCHEMAS = set(MODELS) | UNIONS
EXAMPLED = ["ReportConfig", "SnapshotRef", "BlockPage", "ReportOutline", "ReportAsset", "ReportListItem"]
INDEX_BLOCK_KINDS = {
    "heading",
    "para",
    "kv",
    "kpis",
    "table",
    "figure",
    "figure_row",
    "chart",
    "finding",
    "page_break",
    "volume",
    "cover",
}
INDEX_SNAPSHOT_KINDS = {
    "image_crop",
    "map",
    "elevation",
    "pair",
    "view3d",
    "volume_plan",
    "attachment",
}


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


def _validator(spec: dict, name: str):
    return jsonschema_rs.Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": spec["components"]}
    )


def _errors(spec: dict, name: str, instance) -> list[str]:
    return [e.message for e in _validator(spec, name).iter_errors(instance)]


def _names(model: type[BaseModel]) -> set[str]:
    return {field.alias or name for name, field in model.model_fields.items()}


def _phantom_keys(node, path):
    """An unquoted comma in a flow-mapping description makes a None-valued key with a space."""
    found = []
    if isinstance(node, dict):
        for k, v in node.items():
            if v is None and isinstance(k, str) and " " in k:
                found.append((path, k))
            found += _phantom_keys(v, path + [k])
    elif isinstance(node, list):
        for i, v in enumerate(node):
            found += _phantom_keys(v, path + [i])
    return found


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _members(union) -> tuple:
    return get_args(get_args(union)[0])


# ------------------------------------------------------------------------------ Task 2: schemas


def test_every_reports_schema_is_in_the_contract(spec):
    missing = REPORT_SCHEMAS - set(_schemas(spec))
    assert missing == set(), sorted(missing)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_the_pydantic_model_mirrors_the_contract_schema(spec, name):
    assert _names(MODELS[name]) == set(_schemas(spec)[name]["properties"]), name


@pytest.mark.parametrize("name", sorted(set(MODELS) - REQUESTS))
def test_every_response_and_config_property_is_required(spec, name):
    schema = _schemas(spec)[name]
    assert set(schema.get("required", [])) == set(schema["properties"]), name


def test_no_reports_schema_carries_a_default(spec):
    for name in REPORT_SCHEMAS:
        for node in _walk(_schemas(spec)[name]):
            assert "default" not in node, name


def test_no_flow_mapping_comma_truncates_a_description(spec):
    found = _phantom_keys({n: _schemas(spec)[n] for n in REPORT_SCHEMAS}, [])
    assert found == [], found


def test_the_enums_match_the_literals(spec):
    s = _schemas(spec)
    assert s["SectionKey"]["enum"] == list(schemas.SECTION_KEYS) == list(get_args(schemas.SectionKey))
    assert s["ReportVersionState"]["enum"] == list(get_args(schemas.ReportVersionState))
    assert s["ReportFileKind"]["enum"] == list(get_args(schemas.ReportFileKind))


@pytest.mark.parametrize(
    ("union", "prop", "python", "kinds"),
    [
        ("Block", "kind", schemas.Block, INDEX_BLOCK_KINDS),
        ("SnapshotSpec", "kind", schemas.SnapshotSpec, INDEX_SNAPSHOT_KINDS),
        ("PairSideSpec", "kind", schemas.PairSideSpec, {"map", "elevation"}),
        ("ReportSection", "key", schemas.ReportSection, set(schemas.SECTION_KEYS)),
    ],
)
def test_each_union_is_discriminated_with_the_index_kinds(spec, union, prop, python, kinds):
    schema = _schemas(spec)[union]
    assert schema["discriminator"]["propertyName"] == prop
    mapping = schema["discriminator"]["mapping"]
    assert set(mapping) == kinds
    assert sorted(b["$ref"] for b in schema["oneOf"]) == sorted(mapping.values())
    for kind, ref in mapping.items():
        assert _schemas(spec)[ref.rsplit("/", 1)[1]]["properties"][prop]["enum"] == [kind]
    assert {m.model_fields[prop].default for m in _members(python)} == kinds


def test_the_python_kind_tuples_match_the_index():
    assert set(schemas.BLOCK_KINDS) == INDEX_BLOCK_KINDS
    assert set(schemas.SNAPSHOT_KINDS) == INDEX_SNAPSHOT_KINDS


def test_a_chart_names_its_type_chart_since_kind_is_the_discriminator(spec):
    chart = _schemas(spec)["Chart"]["properties"]
    assert chart["chart"]["enum"] == ["bar", "stacked_bar", "line"]


def test_a_config_always_lists_the_eight_sections(spec):
    sections = _schemas(spec)["ReportConfig"]["properties"]["sections"]
    assert (sections["minItems"], sections["maxItems"]) == (8, 8)
    assert [s.key for s in schemas.default_sections()] == list(schemas.SECTION_KEYS)


def test_the_date_filter_keys_are_from_and_to(spec):
    assert set(_schemas(spec)["ReportDateFilter"]["properties"]) == {"rule", "from", "to", "days"}
    f = schemas.ReportDateFilter.model_validate({"rule": "range", "from": "2026-09-01", "to": "2026-09-30"})
    assert f.model_dump(mode="json", by_alias=True)["from"] == "2026-09-01"


def test_a_version_number_may_be_null_while_rendering(spec):
    s = _schemas(spec)
    assert s["ReportVersion"]["properties"]["number"]["type"] == ["integer", "null"]
    assert s["ReportVersionSummary"]["properties"]["number"]["type"] == ["integer", "null"]


@pytest.mark.parametrize("name", EXAMPLED)
def test_the_mock_has_an_example_that_validates(spec, name):
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    assert _errors(spec, name, example) == [], name


def test_the_config_example_is_the_default_config(spec):
    example = _schemas(spec)["ReportConfig"]["example"]
    default = schemas.ReportConfig().model_dump(mode="json", by_alias=True)
    assert example["sections"] == default["sections"]
    assert example["filters"] == default["filters"]


def test_the_default_config_validates_against_the_contract(spec):
    dumped = schemas.ReportConfig().model_dump(mode="json", by_alias=True)
    assert _errors(spec, "ReportConfig", dumped) == []


def test_the_fixture_document_is_valid_on_both_sides_and_round_trips(spec):
    raw = json.loads(FIXTURE.read_text("utf-8"))
    assert _errors(spec, "ReportDocument", raw) == []
    doc = schemas.ReportDocument.model_validate(raw)
    assert doc.model_dump(mode="json", by_alias=True) == raw


def test_the_fixture_document_has_every_block_and_snapshot_kind():
    raw = json.loads(FIXTURE.read_text("utf-8"))
    nodes = list(_walk(raw))
    blocks = {n["kind"] for n in nodes if "kind" in n and n["kind"] in INDEX_BLOCK_KINDS and "spec" not in n}
    specs = {n["spec"]["kind"] for n in nodes if "spec" in n}
    specs |= {n["kind"] for n in nodes if n.get("kind") in ("map", "elevation") and "item_id" in n}
    assert blocks == INDEX_BLOCK_KINDS
    assert specs == INDEX_SNAPSHOT_KINDS


def test_the_models_leave_cross_field_rules_to_their_owners():
    """A schema-valid config with a section twice, a backwards range or a disabled-cover order must
    parse: R1 refuses it with `invalid_report`, never pydantic's `validation_error`."""
    raw = schemas.ReportConfig().model_dump(mode="json", by_alias=True)
    raw["sections"] = [raw["sections"][0]] * 8
    raw["filters"]["date"] = {"rule": "range", "from": "2026-09-30", "to": "2026-09-01", "days": None}
    config = schemas.ReportConfig.model_validate(raw)
    # The eight duplicated sections are kept exactly as given: pydantic does not dedupe or reorder.
    assert [s.key for s in config.sections] == [raw["sections"][0]["key"]] * 8
    # The backwards date range keeps its from/to values: pydantic does not swap or reject them.
    assert (config.filters.date.from_.isoformat(), config.filters.date.to.isoformat()) == (
        "2026-09-30",
        "2026-09-01",
    )


def test_config_models_forbid_unknown_keys():
    with pytest.raises(ValueError):
        schemas.ReportPaper.model_validate({"size": "A4", "orientation": "portrait", "margin": 5})


# ------------------------------------------------------------------------------ Task 3: operations

P = "/api/v1/projects/{projectId}"
R = P + "/reports/{reportId}"
V = R + "/versions/{versionNumber}"
T = "/api/v1/report-templates"

# operationId -> (method, path, owning unit)
REPORT_OPERATIONS = {
    "listReports": ("get", P + "/reports", "R1"),
    "createReport": ("post", P + "/reports", "R1"),
    "getReport": ("get", R, "R1"),
    "patchReport": ("patch", R, "R1"),
    "deleteReport": ("delete", R, "R1"),
    "duplicateReport": ("post", R + "/duplicate", "R1"),
    "openProjectFile": ("post", P + "/open", "R1"),
    "createReportAsset": ("post", P + "/report-assets", "R1"),
    "getReportAsset": ("get", P + "/report-assets/{assetId}", "R1"),
    "listReportTemplates": ("get", T, "R1"),
    "createReportTemplate": ("post", T, "R1"),
    "getReportTemplate": ("get", T + "/{templateId}", "R1"),
    "patchReportTemplate": ("patch", T + "/{templateId}", "R1"),
    "deleteReportTemplate": ("delete", T + "/{templateId}", "R1"),
    "getReportOutline": ("get", R + "/outline", "R2"),
    "listReportSectionBlocks": ("get", R + "/sections/{sectionKey}/blocks", "R2"),
    "getReportSnapshot": ("get", P + "/report-snapshots/{snapshotKey}", "R3"),
    "createReportRender": ("post", R + "/renders", "R5"),
    "listReportVersions": ("get", R + "/versions", "R5"),
    "getReportVersion": ("get", V, "R5"),
    "patchReportVersion": ("patch", V, "R5"),
    "deleteReportVersion": ("delete", V, "R5"),
    "getReportVersionDocument": ("get", V + "/document", "R5"),
}
# statuses each operation must declare besides its success and `default` (Ruling 7, R1, R5)
DECLARED = {
    "createReport": {"404", "422", "503"},
    "patchReport": {"404", "422"},
    "createReportTemplate": {"422", "503"},
    "patchReportTemplate": {"404", "409", "422", "503"},
    "deleteReportTemplate": {"404", "409", "503"},
    "createReportAsset": {"422"},
    "getReportAsset": {"404"},
    "openProjectFile": {"404", "409"},
    "getReportSnapshot": {"400", "404"},
    "createReportRender": {"404", "409"},
    "deleteReportVersion": {"404", "409"},
}


def test_the_reports_tag_has_exactly_these_operations(spec):
    ops = _operations(spec)
    tagged = {op_id for op_id, (_, _, op) in ops.items() if "reports" in op.get("tags", [])}
    assert tagged == set(REPORT_OPERATIONS)
    for op_id, (method, path, _) in REPORT_OPERATIONS.items():
        assert ops[op_id][:2] == (method, path), op_id
        assert ops[op_id][2]["responses"]["default"] == {"$ref": "#/components/responses/Error"}
    assert "reports" in {t["name"] for t in spec["tags"]}


@pytest.mark.parametrize("op_id", sorted(DECLARED))
def test_the_owner_refusals_are_declared(spec, op_id):
    assert DECLARED[op_id] <= set(_operations(spec)[op_id][2]["responses"]), op_id


def test_pages_of_blocks_are_capped_at_50(spec):
    limit = spec["components"]["parameters"]["blocksLimit"]
    assert (limit["name"], limit["in"], limit["schema"]["maximum"]) == ("limit", "query", 50)
    for op_id in ("listReportSectionBlocks", "getReportVersionDocument"):
        refs = [p.get("$ref") for p in _operations(spec)[op_id][2]["parameters"]]
        assert "#/components/parameters/blocksLimit" in refs, op_id


def test_the_snapshot_is_a_jpeg_keyed_by_its_spec(spec):
    op = _operations(spec)["getReportSnapshot"][2]
    assert "image/jpeg" in op["responses"]["200"]["content"]
    assert spec["components"]["parameters"]["snapshotSpec"]["required"] is True
    assert spec["components"]["parameters"]["snapshotKey"]["schema"]["pattern"] == "^[0-9a-f]{32}$"


def test_the_reports_error_codes_are_documented(spec):
    text = _schemas(spec)["Error"]["properties"]["error"]["properties"]["code"]["description"]
    for code in (
        "invalid_report",
        "invalid_template",
        "builtin_template",
        "asset_invalid",
        "render_running",
        "issued_version",
        "invalid_snapshot_spec",
        "snapshot_key_mismatch",
    ):
        assert code in text, code


# ------------------------------------------------------------------------------ Task 5


def test_the_report_render_job_type(spec):
    assert "report_render" in _schemas(spec)["JobType"]["enum"]
    assert (
        "report_render {version_id, number, folder, files}"
        in (_schemas(spec)["Job"]["properties"]["result"]["description"])
    )


def test_the_detect_pdf_format_is_deprecated_but_still_accepted(spec):
    fmt = _schemas(spec)["DetectExportRequest"]["properties"]["format"]
    branches = {b["const"]: b for b in fmt["oneOf"]}
    assert set(branches) == {"csv", "pdf"}
    assert branches["pdf"].get("deprecated") is True
    assert "deprecated" not in branches["csv"]
    assert not _operations(spec)["createDetectExport"][2].get("deprecated")
