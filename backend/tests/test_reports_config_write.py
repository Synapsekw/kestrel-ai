"""Write-time config parsing and template portability (plan R1 Task 1, spec §7.1, §14 PATCH 422)."""

import pydantic
import pytest
from reports_helpers import builtin, config_json

from app.errors import AppError
from app.reports.config_write import (
    config_for_project,
    config_problems,
    parse_config,
    parse_title,
    portable_config,
    validation_errors,
)
from app.reports.schemas import ReportPatch


def _paths(exc: AppError) -> set[str]:
    return {e["path"] for e in exc.details["errors"]}


def test_a_builtin_config_parses():
    cfg = parse_config(config_json(), code="invalid_report")
    assert [s.key for s in cfg.sections]


def test_schema_errors_come_back_with_a_dotted_path():
    raw = config_json()
    raw["sections"][0]["key"] = "not_a_section"
    raw["paper"]["size"] = "A0"
    with pytest.raises(AppError) as e:
        parse_config(raw, code="invalid_report")
    assert (e.value.status, e.value.code) == (422, "invalid_report")
    paths = _paths(e.value)
    assert any(p.startswith("config.sections.0") for p in paths), paths
    assert any(p.startswith("config.paper.size") for p in paths), paths


def test_a_non_object_config_is_one_error_at_the_root():
    with pytest.raises(AppError) as e:
        parse_config("nope", code="invalid_report")
    assert _paths(e.value) == {"config"}


def test_duplicate_section_keys_name_the_second_one():
    # Ruling P1: sections is pinned to exactly 8 (min/max_length 8), so a 9th section is a schema
    # error at config.sections, not the semantic duplicate-key rule. Duplicate one of the 8 instead.
    raw = config_json()
    raw["sections"][1] = dict(raw["sections"][0])
    with pytest.raises(AppError) as e:
        parse_config(raw, code="invalid_report")
    assert _paths(e.value) == {"config.sections.1.key"}


def test_range_needs_from_before_to():
    raw = config_json()
    raw["filters"]["date"] = {"rule": "range", "from": "2026-09-20", "to": "2026-09-01"}
    with pytest.raises(AppError) as e:
        parse_config(raw, code="invalid_report")
    assert _paths(e.value) == {"config.filters.date.to"}


def test_range_needs_both_ends():
    raw = config_json()
    raw["filters"]["date"] = {"rule": "range"}
    with pytest.raises(AppError) as e:
        parse_config(raw, code="invalid_report")
    assert _paths(e.value) == {"config.filters.date.from", "config.filters.date.to"}


def test_last_days_needs_a_positive_count():
    raw = config_json()
    raw["filters"]["date"] = {"rule": "last_days", "days": 0}
    with pytest.raises(AppError) as e:
        parse_config(raw, code="invalid_report")
    assert "config.filters.date.days" in _paths(e.value)


def test_config_problems_is_empty_for_a_builtin():
    assert config_problems(parse_config(config_json(), code="x")) == []


def test_portable_config_strips_project_only_fields_and_keeps_the_rest():
    raw = config_json()
    raw["filters"]["data_item_ids"] = ["item-1"]
    raw["filters"]["type_ids"] = ["type-1"]
    raw["cover"]["logo_asset_id"] = "asset-1"
    raw["cover"]["report_date"] = "2026-09-24"
    raw["cover"]["client"] = "ACME"
    parsed = parse_config(raw, code="x")
    out = portable_config(parsed)
    assert out.filters.data_item_ids is None
    assert out.cover.logo_asset_id is None
    assert out.cover.report_date is None
    assert out.filters.type_ids == ["type-1"]
    assert out.cover.client == "ACME"
    assert [s.key for s in out.sections] == [s["key"] for s in raw["sections"]]
    # handoff from R0: portable_config must not mutate its input
    assert parsed.filters.data_item_ids == ["item-1"]
    assert parsed.cover.logo_asset_id == "asset-1"
    assert parsed.cover.report_date is not None


def test_config_for_project_sets_the_title_and_strips():
    raw = config_json()
    raw["filters"]["data_item_ids"] = ["item-1"]
    parsed = parse_config(raw, code="x")
    out = config_for_project(parsed, title="North wall")
    assert out.cover.title == "North wall"
    assert out.filters.data_item_ids is None
    # config_for_project must not mutate its input either
    assert parsed.filters.data_item_ids == ["item-1"]


def test_builtin_templates_are_not_mutated_by_portable_config_or_config_for_project():
    tmpl = builtin("builtin-full")
    before = tmpl.config.model_dump(mode="json", by_alias=True)
    portable_config(tmpl.config)
    config_for_project(tmpl.config, title="Someone else's report")
    after = tmpl.config.model_dump(mode="json", by_alias=True)
    assert before == after


@pytest.mark.parametrize(
    ("raw", "value", "ok"),
    [("  Site A ", "Site A", True), ("   ", None, False), ("x" * 201, None, False), (7, None, False)],
)
def test_parse_title(raw, value, ok):
    got, errors = parse_title(raw)
    assert got == value
    assert (errors == []) is ok
    if not ok:
        assert errors[0]["path"] == "title"


def test_validation_errors_is_a_public_helper_for_whole_request_bodies():
    # Ruling P2: later tasks validate whole request bodies (ReportPatch etc.) against R0's
    # request models with this helper, not just config_write's own ReportConfig parsing.
    raw = config_json()
    raw["paper"]["size"] = "A0"
    body = {"config": raw, "extra": 1}
    with pytest.raises(pydantic.ValidationError) as exc_info:
        ReportPatch.model_validate(body)
    errors = validation_errors(exc_info.value)
    paths = {err["path"] for err in errors}
    assert "config.paper.size" in paths
    assert "extra" in paths
    assert all(set(err) == {"path", "message"} for err in errors)
