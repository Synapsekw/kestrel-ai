"""The four built-in report templates (spec 2026-09-26-reports section 6.2; index fixed ids): the
data the catalogue migration seeds and the fallback served when the catalogue is unavailable."""

from pathlib import Path

import jsonschema_rs
import pytest
import yaml

from app.reports.schemas import SECTION_KEYS, ReportConfig
from app.reports.templates import builtins

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
ON = {
    "builtin-full": [k for k in SECTION_KEYS if k != "asset_summary"],
    "builtin-findings-summary": ["cover", "summary", "findings_table"],
    "builtin-survey-counts": ["cover", "comparison", "object_counts"],
    "builtin-volumes": ["cover", "measurements", "appendix"],
}


@pytest.fixture(scope="module")
def validator():
    components = yaml.safe_load(SPEC.read_text("utf-8"))["components"]
    return jsonschema_rs.Draft202012Validator(
        {"$ref": "#/components/schemas/ReportTemplate", "components": components}
    )


def test_the_built_ins_have_the_index_ids_in_order():
    assert builtins.BUILTIN_IDS == (
        "builtin-full",
        "builtin-findings-summary",
        "builtin-survey-counts",
        "builtin-volumes",
    )
    assert [t.id for t in builtins.BUILTIN_TEMPLATES] == list(builtins.BUILTIN_IDS)
    assert [t.name for t in builtins.BUILTIN_TEMPLATES] == [
        "Full inspection report",
        "Findings summary",
        "Survey count report",
        "Volumes report",
    ]
    assert all(t.builtin and t.description for t in builtins.BUILTIN_TEMPLATES)


@pytest.mark.parametrize("template", builtins.BUILTIN_TEMPLATES, ids=lambda t: t.id)
def test_each_lists_every_section_once_with_its_own_on_first(template):
    keys = [s.key for s in template.config.sections]
    assert sorted(keys) == sorted(SECTION_KEYS)
    on = ON[template.id]
    assert keys[: len(on)] == on
    assert [s.key for s in template.config.sections if s.enabled] == on
    assert keys[len(on) :] == [k for k in SECTION_KEYS if k not in on]


@pytest.mark.parametrize("template", builtins.BUILTIN_TEMPLATES, ids=lambda t: t.id)
def test_each_is_portable_and_valid_against_the_contract(template, validator):
    f = template.config.filters
    assert (f.data_item_ids, template.config.cover.logo_asset_id, template.config.cover.report_date) == (
        None,
        None,
        None,
    )
    dumped = template.model_dump(mode="json", by_alias=True)
    assert [e.message for e in validator.iter_errors(dumped)] == []


def test_the_volumes_report_measures_volumes_only():
    volumes = builtins.builtin_template("builtin-volumes")
    options = next(s.options for s in volumes.config.sections if s.key == "measurements")
    assert options.kinds == ["volume"]
    full = builtins.builtin_template("builtin-full")
    assert next(s.options for s in full.config.sections if s.key == "measurements").kinds == [
        "length",
        "area",
        "height",
        "lean",
        "profile",
        "volume",
    ]


def test_lookup_and_the_default_config():
    assert builtins.builtin_template("builtin-full") is builtins.BUILTIN_TEMPLATES[0]
    assert builtins.builtin_template("nope") is None
    assert builtins.default_config() == ReportConfig()
    # The full template lists the opt-in asset_summary last (disabled); the default keeps canonical order.
    full = builtins.builtin_template("builtin-full").config
    assert builtins.default_config().model_dump() == {
        **full.model_dump(),
        "sections": sorted(full.model_dump()["sections"], key=lambda s: SECTION_KEYS.index(s["key"])),
    }
