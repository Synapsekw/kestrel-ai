"""The comparison section (reports spec §7.2 row `comparison`, §9.3, §16; Rulings 10-13)."""

from datetime import date

from reports_m_rows import add_geomap, make_ctx, map_run

from app.reports.sections import comparison

ONE_SURVEY = "One survey so far: nothing to compare."


def _blocks(doc, kind):
    return [b for b in doc.blocks if b.kind == kind]


def test_one_survey_says_nothing_to_compare(handle, project):
    exc = project["classes"][0]["id"]
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    map_run(handle, map_id=gm, counts={exc: 3})
    doc = comparison.compose(make_ctx(handle, "comparison"))
    assert doc.key == "comparison"
    assert any(getattr(b, "text", "") == ONE_SURVEY for b in doc.blocks)
    [chart] = _blocks(doc, "chart")  # the counts chart still prints
    assert chart.unit == "objects"


def test_no_survey_at_all_composes(handle):
    doc = comparison.compose(make_ctx(handle, "comparison"))
    assert any(getattr(b, "text", "") == ONE_SURVEY for b in doc.blocks)
    assert _blocks(doc, "chart") == []


def test_auto_pairs_print_a_swipe_and_a_side_by_side_per_pair(handle, project):
    exc = project["classes"][0]["id"]
    for name, m in (("Jul", 7), ("Aug", 8), ("Sep", 9)):
        map_run(handle, map_id=add_geomap(handle, name=name, captured_on=date(2026, m, 1)), counts={exc: m})
    doc = comparison.compose(make_ctx(handle, "comparison", pairs="auto", mode="both", counts_chart=True))
    figures = _blocks(doc, "figure")
    assert [f.snapshot.spec.mode for f in figures] == ["swipe", "side_by_side"] * 2
    [chart] = _blocks(doc, "chart")
    assert chart.chart == "line" and chart.x_labels == ["01 Jul 2026", "01 Aug 2026", "01 Sep 2026"]
    assert chart.series[0].values == [7, 8, 9]


def test_counts_chart_off_prints_no_chart(handle):
    add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    doc = comparison.compose(make_ctx(handle, "comparison", counts_chart=False))
    assert _blocks(doc, "chart") == []


def test_an_explicit_pair_with_a_missing_map_is_skipped_with_a_warning(handle):
    a = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    b = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    ctx = make_ctx(
        handle,
        "comparison",
        pairs=[{"item_a": a, "item_b": b}, {"item_a": a, "item_b": "gone"}],
        mode="swipe",
    )
    doc = comparison.compose(ctx)
    assert len(_blocks(doc, "figure")) == 1
    assert any(w.code == "pair_missing" for w in ctx.warnings)
