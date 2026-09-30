"""The four built-in report templates (spec 2026-09-26-reports section 6.2; index fixed ids).

Catalogue migration 0002 seeds a frozen copy of this data; tests/test_catalogue_migration_0002.py
pins that the two agree. When the catalogue is unavailable, R1 serves these from code. A built-in is
duplicated, never edited or deleted. Every config lists all eight sections: the template's own
sections first and enabled, the rest after them in canonical order and disabled (plan R0 rulings 2
and 13). Filters are portable: no data items, no logo, no report date.
"""

from datetime import UTC, datetime

from app.reports.schemas import SECTION_KEYS, ReportConfig, ReportTemplate, SectionKey

BUILTIN_FULL = "builtin-full"
BUILTIN_FINDINGS_SUMMARY = "builtin-findings-summary"
BUILTIN_SURVEY_COUNTS = "builtin-survey-counts"
BUILTIN_VOLUMES = "builtin-volumes"
BUILTIN_IDS = (BUILTIN_FULL, BUILTIN_FINDINGS_SUMMARY, BUILTIN_SURVEY_COUNTS, BUILTIN_VOLUMES)
SEEDED_AT = datetime(2026, 9, 30, tzinfo=UTC)


def default_config() -> ReportConfig:
    """A new report's config: every section on, in canonical order, with default options."""
    return ReportConfig()


def _config(on: tuple[SectionKey, ...], options: dict[SectionKey, dict] | None = None) -> ReportConfig:
    base = {s.key: s for s in ReportConfig().sections}
    sections = []
    for key in [*on, *(k for k in SECTION_KEYS if k not in on)]:
        update: dict = {"enabled": key in on}
        if options and key in options:
            update["options"] = base[key].options.model_copy(update=options[key])
        sections.append(base[key].model_copy(update=update))
    return ReportConfig(sections=sections)


def _template(id_: str, name: str, description: str, config: ReportConfig) -> ReportTemplate:
    return ReportTemplate(
        id=id_,
        name=name,
        description=description,
        builtin=True,
        config=config,
        created_at=SEEDED_AT,
        updated_at=SEEDED_AT,
    )


BUILTIN_TEMPLATES: list[ReportTemplate] = [
    _template(
        BUILTIN_FULL,
        "Full inspection report",
        "Every section: cover, summary, findings table, a page per finding, measurements,"
        " survey comparison, object counts and the data appendix.",
        _config(SECTION_KEYS),
    ),
    _template(
        BUILTIN_FINDINGS_SUMMARY,
        "Findings summary",
        "Cover, executive summary and the findings table.",
        _config(("cover", "summary", "findings_table")),
    ),
    _template(
        BUILTIN_SURVEY_COUNTS,
        "Survey count report",
        "Cover, survey comparison and object counts. Replaces the detection PDF per source.",
        _config(("cover", "comparison", "object_counts")),
    ),
    _template(
        BUILTIN_VOLUMES,
        "Volumes report",
        "Cover, volume measurements and the data appendix.",
        _config(("cover", "measurements", "appendix"), {"measurements": {"kinds": ["volume"]}}),
    ),
]
_BY_ID = {t.id: t for t in BUILTIN_TEMPLATES}


def builtin_template(template_id: str) -> ReportTemplate | None:
    return _BY_ID.get(template_id)
