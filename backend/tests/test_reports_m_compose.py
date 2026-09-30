"""R9-M through R2's real composer: the three sections are registered, and the whole report composes
over a project with maps, a measurement, a volume, runs and photo batches (spec §8.2)."""

from datetime import date

from reports_m_rows import (
    GENERATED_AT,
    add_dem,
    add_geomap,
    map_finding,
    map_measurement,
    map_run,
    ready_volume,
)

from app.reports.compose import SECTION_COMPOSERS, compose
from app.reports.figures import map_geo
from app.reports.sections import comparison, measurements, object_counts
from app.reports.templates.builtins import BUILTIN_TEMPLATES

STUB_TEXTS = (measurements.EMPTY, comparison.ONE_SURVEY, object_counts.EMPTY)


def test_the_three_sections_are_r9ms():
    assert SECTION_COMPOSERS["measurements"] is measurements.compose
    assert SECTION_COMPOSERS["comparison"] is comparison.compose
    assert SECTION_COMPOSERS["object_counts"] is object_counts.compose


def test_the_full_report_composes_and_is_deterministic(handle, project):
    exc = project["classes"][0]["id"]
    aug = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    sep = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(handle, map_id=aug, counts={exc: 3})
    map_run(handle, map_id=sep, counts={exc: 5})
    map_measurement(handle, kind="distance", vertices=[[500010, 4982990], [500040, 4982960]], map_id=sep)
    ready_volume(handle, add_dem(handle))
    map_finding(handle, map_id=sep, geometry=map_geo.point(500050, 4982950), number=1, type_id=exc)
    config = next(t for t in BUILTIN_TEMPLATES if t.id == "builtin-full").config

    def run():
        return compose(handle, config, report_id="r1", baseline=None, generated_at=GENERATED_AT)

    first, second = run(), run()
    assert first.model_dump_json() == second.model_dump_json()
    keys = [s.key for s in first.sections]
    for key in ("measurements", "comparison", "object_counts", "finding_pages"):
        assert key in keys
    by_key = {s.key: s for s in first.sections}
    assert any(b.kind == "volume" for b in by_key["measurements"].blocks)
    assert any(b.kind == "chart" for b in by_key["comparison"].blocks)


def test_no_section_shows_its_stub_paragraph(handle, project):
    """The three R9-M sections have real data here (measurement, volume, runs, finding), so none
    of them falls back to its own empty-state stub paragraph (measurements.EMPTY,
    comparison.ONE_SURVEY, object_counts.EMPTY)."""
    exc = project["classes"][0]["id"]
    aug = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    sep = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(handle, map_id=aug, counts={exc: 3})
    map_run(handle, map_id=sep, counts={exc: 5})
    map_measurement(handle, kind="distance", vertices=[[500010, 4982990], [500040, 4982960]], map_id=sep)
    ready_volume(handle, add_dem(handle))
    map_finding(handle, map_id=sep, geometry=map_geo.point(500050, 4982950), number=1, type_id=exc)
    config = next(t for t in BUILTIN_TEMPLATES if t.id == "builtin-full").config

    doc = compose(handle, config, report_id="r1", baseline=None, generated_at=GENERATED_AT)
    by_key = {s.key: s for s in doc.sections}
    for key in ("measurements", "comparison", "object_counts"):
        paras = [b.text for b in by_key[key].blocks if b.kind == "para"]
        assert not any(p in STUB_TEXTS for p in paras), (key, paras)
