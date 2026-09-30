"""Unit S1-U1: contract/openapi.yaml carries every project-setup schema and path (spec
2026-09-30-project-setup section 9), and app/catalogue/schemas.py and app/setup/schemas.py mirror
them one-to-one (plan 2026-09-30-setup-u1)."""

from pathlib import Path
from typing import get_args

import jsonschema_rs
import pytest
import yaml
from pydantic import ValidationError

from app.catalogue import schemas as catalogue_schemas
from app.catalogue.service import CatalogueTypeRef

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
