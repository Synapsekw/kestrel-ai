"""C0 Appendix A, landed by R1: the report config's asset additions."""

from app.reports.schemas import SECTION_KEYS, ReportConfig
from app.reports.templates.builtins import BUILTIN_TEMPLATES


def test_the_default_config_has_the_asset_additions():
    c = ReportConfig()
    assert SECTION_KEYS[2] == "asset_summary" and len(c.sections) == 9
    summary = next(s for s in c.sections if s.key == "asset_summary")
    assert summary.enabled is False
    assert summary.options.model_dump() == {"asset_model_id": None, "show_map": True, "show_tables": True}
    assert c.csv_layout == "findings"
    pages = next(s for s in c.sections if s.key == "finding_pages")
    assert pages.options.min_severity is None
    table = next(s for s in c.sections if s.key == "findings_table")
    assert "zone" not in table.options.columns  # the defaults stay the seven


def test_a_config_saved_before_asset_summary_still_reads():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    raw["sections"] = [s for s in raw["sections"] if s["key"] != "asset_summary"]
    del raw["csv_layout"]
    c = ReportConfig.model_validate(raw)
    assert len(c.sections) == 8 and c.csv_layout == "findings"


def test_the_table_takes_the_asset_columns_and_pages_take_min_severity():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    for s in raw["sections"]:
        if s["key"] == "findings_table":
            s["options"]["columns"] = ["number", "zone", "side", "height", "sightings"]
        if s["key"] == "finding_pages":
            s["options"]["min_severity"] = 2
    c = ReportConfig.model_validate(raw)
    assert next(s for s in c.sections if s.key == "finding_pages").options.min_severity == 2


def test_no_builtin_template_turns_the_asset_summary_on():
    for t in BUILTIN_TEMPLATES:
        assert [s.key for s in t.config.sections].count("asset_summary") == 1
        assert not next(s for s in t.config.sections if s.key == "asset_summary").enabled
