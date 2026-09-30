"""Unit S1-U1: contract/openapi.yaml carries every project-setup schema and path (spec
2026-09-30-project-setup section 9), and app/catalogue/schemas.py and app/setup/schemas.py mirror
them one-to-one (plan 2026-09-30-setup-u1)."""

from pathlib import Path
from typing import get_args

import jsonschema_rs
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from app.catalogue import schemas as catalogue_schemas
from app.catalogue.service import CatalogueTypeRef
from app.setup import schemas as setup_schemas

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")


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


def _errors(spec: dict, name: str, instance) -> list[str]:
    validator = jsonschema_rs.Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": spec["components"]}
    )
    return [e.message for e in validator.iter_errors(instance)]


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


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


# ------------------------------------------------------------------------------ Task 1: type fields

# pydantic class in app/catalogue/schemas.py -> contract schema
CATALOGUE_MIRROR = {
    "SeverityRule": "SeverityRule",
    "CatalogueTypeOut": "CatalogueType",
    "CatalogueTypeCreate": "CatalogueTypeCreate",
    "CatalogueTypePatch": "CatalogueTypePatch",
}
ORIGINS = ["user", "migrated", "template"]


@pytest.mark.parametrize(("model", "schema"), sorted(CATALOGUE_MIRROR.items()))
def test_the_catalogue_models_mirror_the_contract(spec, model, schema):
    fields = set(getattr(catalogue_schemas, model).model_fields)
    assert fields == set(_schemas(spec)[schema]["properties"]), model


def test_a_catalogue_type_carries_a_definition_and_ordered_rules(spec):
    s = _schemas(spec)
    assert {"definition", "severity_rules"} <= set(s["CatalogueType"]["required"])
    for name in ("CatalogueType", "CatalogueTypeCreate", "CatalogueTypePatch"):
        props = s[name]["properties"]
        assert props["definition"]["type"] == ["string", "null"], name
        assert props["definition"]["maxLength"] == catalogue_schemas.DEFINITION_MAX == 1000, name
        assert props["severity_rules"]["maxItems"] == catalogue_schemas.MAX_SEVERITY_RULES == 8, name
        assert props["severity_rules"]["items"] == {"$ref": "#/components/schemas/SeverityRule"}, name
    for name in ("CatalogueTypeCreate", "CatalogueTypePatch"):
        assert not {"definition", "severity_rules"} & set(s[name].get("required", [])), name


def test_origin_gains_template_everywhere(spec):
    assert _schemas(spec)["CatalogueType"]["properties"]["origin"]["enum"] == ORIGINS
    assert list(get_args(catalogue_schemas.TypeOrigin)) == ORIGINS == list(catalogue_schemas.TYPE_ORIGINS)
    params = _operations(spec)["listCatalogueTypes"][2]["parameters"]
    origin = next(p for p in params if p.get("name") == "origin")
    assert origin["schema"]["enum"] == ORIGINS


def test_a_severity_rule(spec):
    rule = _schemas(spec)["SeverityRule"]
    assert (rule["required"], rule["additionalProperties"]) == (["when", "severity"], False)
    assert rule["properties"]["when"]["maxLength"] == 200
    assert (rule["properties"]["severity"]["minimum"], rule["properties"]["severity"]["maximum"]) == (1, 9)
    assert catalogue_schemas.SeverityRule.model_config["extra"] == "forbid"
    with pytest.raises(ValidationError):
        catalogue_schemas.SeverityRule(when="Holes", severity=10)
    with pytest.raises(ValidationError):
        catalogue_schemas.SeverityRule(when="   ", severity=2)


@pytest.mark.parametrize(
    "name",
    ["SeverityRule", "CatalogueType", "CatalogueTypePage", "CatalogueTypeCreate", "CatalogueTypeUpdated"],
)
def test_the_catalogue_examples_validate(spec, name):
    example = _schemas(spec)[name]["example"]
    assert _errors(spec, name, example) == [], name


def test_a_type_answer_carries_both_new_keys_before_u2_fills_them(spec):
    """U2 adds `definition` and `severity_rules` to CatalogueTypeRef; until then `from_ref` fills the
    defaults, and every answer still carries both keys the contract requires."""
    ref = CatalogueTypeRef(
        id="t1",
        name="Rust",
        colour="#c2410c",
        kind="defect",
        default_severity=None,
        hotkey=None,
        group=None,
        archived=False,
        origin="template",
    )
    out = catalogue_schemas.CatalogueTypeOut.from_ref(ref).model_dump(mode="json")
    assert (out["definition"], out["severity_rules"]) == (None, [])
    assert _errors(spec, "CatalogueType", out) == []


# ------------------------------------------------------------------------------ Task 2: new schemas

# pydantic class -> contract schema, for every class U1 adds besides Task 1's
S1_MIRROR = {
    **{
        name: name
        for name in (
            "CatalogueTypeSpec",
            "EnsureTypesRequest",
            "TypeConflict",
            "EnsuredType",
            "EnsureTypesResult",
        )
    },
    **{
        name: name
        for name, obj in vars(setup_schemas).items()
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj.__module__ == setup_schemas.__name__
    },
    "ProjectTemplateOut": "ProjectTemplate",
}
S1_SCHEMAS = set(S1_MIRROR.values()) | {"SlotRoute", "SeverityRule"}
# Request bodies and what they nest: closed (`additionalProperties: false`, pydantic `extra="forbid"`).
CLOSED = {
    "SeverityRule",
    "CatalogueTypeSpec",
    "EnsureTypesRequest",
    "SlotMatch",
    "TemplateSlot",
    "TemplateConfig",
    "ProjectTemplateCreate",
    "ProjectTemplatePatch",
    "SetupInspectRequest",
}
# Request-only shapes: only their required keys are required. Every other schema requires every key.
REQUESTS = {
    "CatalogueTypeSpec",
    "EnsureTypesRequest",
    "SlotMatch",
    "ProjectTemplateCreate",
    "ProjectTemplatePatch",
    "SetupInspectRequest",
}
# (schema, property, keyword, value): the index's bounds, which the owners must not drift from.
BOUNDS = [
    ("EnsureTypesRequest", "types", "maxItems", 64),
    ("EnsureTypesRequest", "types", "minItems", 1),
    ("EnsureTypesResult", "items", "maxItems", 64),
    ("TemplateConfig", "slots", "maxItems", 16),
    ("TemplateConfig", "types", "maxItems", 64),
    ("TemplateSlot", "accepts", "maxItems", 12),
    ("TemplateSlot", "label", "maxLength", 48),
    ("CatalogueTypeSpec", "name", "maxLength", 64),
    ("CatalogueTypeSpec", "definition", "maxLength", 1000),
    ("CatalogueTypeSpec", "severity_rules", "maxItems", 8),
    ("ProjectTemplateCreate", "name", "maxLength", 80),
    ("ProjectTemplateCreate", "description", "maxLength", 300),
    ("SetupInspectRequest", "paths", "maxItems", 16),
    ("SetupInspectRequest", "paths", "minItems", 1),
    ("InspectBucket", "files", "maxItems", 200),
    ("InspectBucket", "samples", "maxItems", 200),
    ("InspectNotRecognised", "samples", "maxItems", 50),
    ("InspectResult", "buckets", "maxItems", 500),
]
PYTHON_BOUNDS = {
    "MAX_SLOTS": 16,
    "MAX_TEMPLATE_TYPES": 64,
    "MAX_INSPECT_PATHS": 16,
    "MAX_BUCKET_FILES": 200,
    "MAX_BUCKET_SAMPLES": 200,
    "MAX_NOT_RECOGNISED_SAMPLES": 50,
    "MAX_INSPECT_BUCKETS": 500,
}
EXAMPLED = ["CatalogueTypeSpec", "EnsureTypesResult", "ProjectTemplatePage", "InspectResult"]


def _model(name: str) -> type[BaseModel]:
    return getattr(setup_schemas, name, None) or getattr(catalogue_schemas, name)


def test_every_setup_schema_is_in_the_contract(spec):
    missing = S1_SCHEMAS - set(_schemas(spec))
    assert missing == set(), sorted(missing)


@pytest.mark.parametrize(("model", "schema"), sorted(S1_MIRROR.items()))
def test_the_setup_models_mirror_the_contract(spec, model, schema):
    assert set(_model(model).model_fields) == set(_schemas(spec)[schema]["properties"]), model


@pytest.mark.parametrize("schema", sorted(set(S1_MIRROR.values()) - REQUESTS))
def test_every_response_and_config_property_is_required(spec, schema):
    s = _schemas(spec)[schema]
    assert set(s.get("required", [])) == set(s["properties"]), schema


@pytest.mark.parametrize("schema", sorted(CLOSED))
def test_request_shapes_are_closed_on_both_sides(spec, schema):
    assert _schemas(spec)[schema]["additionalProperties"] is False, schema
    assert _model(schema).model_config.get("extra") == "forbid", schema


def test_no_setup_schema_carries_a_default(spec):
    for name in S1_SCHEMAS:
        for node in _walk(_schemas(spec)[name]):
            assert "default" not in node, name


def test_no_flow_mapping_comma_truncates_a_description(spec):
    found = _phantom_keys({n: _schemas(spec)[n] for n in S1_SCHEMAS | {"CatalogueType", "ProjectCreate"}}, [])
    assert found == [], found


def test_the_enums_match_the_literals(spec):
    s = _schemas(spec)
    assert (
        s["SlotRoute"]["enum"] == list(setup_schemas.SLOT_ROUTES) == list(get_args(setup_schemas.SlotRoute))
    )
    assert s["SlotMatch"]["properties"]["raster"]["enum"] == list(get_args(setup_schemas.RasterMatch))
    assert s["TemplateConfig"]["properties"]["config_version"] == {"type": "integer", "const": 1}
    with pytest.raises(ValidationError):
        setup_schemas.TemplateConfig(config_version=2, slots=[], types=[])


@pytest.mark.parametrize(("schema", "prop", "keyword", "value"), BOUNDS)
def test_the_contract_encodes_the_budget(spec, schema, prop, keyword, value):
    assert _schemas(spec)[schema]["properties"][prop][keyword] == value


def test_the_python_bounds_match_the_contract():
    assert {k: getattr(setup_schemas, k) for k in PYTHON_BOUNDS} == PYTHON_BOUNDS
    assert catalogue_schemas.MAX_ENSURE_TYPES == 64


def test_a_type_spec_needs_only_a_name_and_a_kind_and_dumps_every_key(spec):
    assert _schemas(spec)["CatalogueTypeSpec"]["required"] == ["name", "kind"]
    dumped = catalogue_schemas.CatalogueTypeSpec(name="Rust", kind="defect").model_dump(mode="json")
    assert set(dumped) == set(_schemas(spec)["CatalogueTypeSpec"]["properties"])
    assert _errors(spec, "CatalogueTypeSpec", dumped) == []


@pytest.mark.parametrize("name", EXAMPLED)
def test_the_mock_has_an_example_that_validates(spec, name):
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    assert _errors(spec, name, example) == [], name


def test_the_inspect_result_example_round_trips(spec):
    example = _schemas(spec)["InspectResult"]["example"]
    assert setup_schemas.InspectResult.model_validate(example).model_dump(mode="json") == example


def test_a_slot_match_never_serialises_a_null(spec):
    """Coordinator ruling (U2 planner): `SlotMatch` keys are optional, never null. A template slot
    with `match: {raster: "ortho"}` must come back without `thermal: null`; `match: null` stays."""
    assert setup_schemas.SlotMatch(raster="ortho").model_dump() == {"raster": "ortho"}
    assert setup_schemas.SlotMatch().model_dump(mode="json") == {}
    assert setup_schemas.SlotMatch(raster="ortho", thermal=None).model_dump() == {"raster": "ortho"}
    ortho = {"key": "ortho", "label": "Orthomosaic", "route": "map", "required": True, "accepts": ["tif"]}
    app = FastAPI()

    @app.post("/echo", response_model=setup_schemas.TemplateSlot)
    def echo(body: setup_schemas.TemplateSlot) -> setup_schemas.TemplateSlot:
        return body

    with TestClient(app) as client:
        for match in ({"raster": "ortho"}, {"thermal": True}, None):
            answer = client.post("/echo", json={**ortho, "match": match}).json()
            assert answer["match"] == match
            assert _errors(spec, "TemplateSlot", answer) == []


def test_project_create_takes_hotkeys_like_put_project_types(spec):
    s = _schemas(spec)
    hotkeys = s["ProjectCreate"]["properties"]["hotkeys"]
    assert (
        hotkeys["additionalProperties"]
        == s["ProjectTypesUpdate"]["properties"]["hotkeys"]["additionalProperties"]
    )
    assert "hotkeys" not in s["ProjectCreate"]["required"]


def test_the_models_leave_cross_field_rules_to_their_owners():
    """A config with a slot key, a type name and a hotkey twice must parse: U2 refuses it with
    `invalid_template`, never pydantic's `validation_error`."""
    slot = {"key": "a", "label": "A", "route": "images", "required": False, "accepts": ["jpg"], "match": None}
    kind = {"kind": "defect", "hotkey": "1"}
    config = setup_schemas.TemplateConfig.model_validate(
        {
            "config_version": 1,
            "slots": [slot, slot],
            "types": [{"name": "Rust", **kind}, {"name": "rust", **kind}],
        }
    )
    assert len(config.slots) == 2 and len(config.types) == 2


# ------------------------------------------------------------------------------ Task 3: job type


def test_the_setup_inspect_job_type(spec):
    assert _schemas(spec)["JobType"]["enum"][-1] == "setup_inspect"
    description = _schemas(spec)["Job"]["properties"]["result"]["description"]
    assert (
        "setup_inspect InspectResult {buckets, not_recognised, suggested_template_id, truncated}"
        in description
    )
    assert "(params {paths, template_id})" in description
