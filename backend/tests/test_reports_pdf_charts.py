"""Charts are reportlab.graphics drawings, vector, no PNG (spec §10.2)."""

import pytest
from report_pdf_helpers import pdf_pages_text
from reportlab.graphics import renderPDF
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.lib.units import mm

from app.reports.pdf import charts, fonts, styles

ST = styles.build_styles(fonts.register_fonts())
S = charts.ChartSeries


def _render(tmp_path, drawing):
    path = tmp_path / "chart.pdf"
    renderPDF.drawToFile(drawing, str(path))
    return path, path.read_bytes()


def _plot(drawing):
    """The VerticalBarChart/HorizontalLineChart content of a chart Drawing."""
    for item in drawing.contents:
        if isinstance(item, (VerticalBarChart, HorizontalLineChart)):
            return item
    raise AssertionError("no chart plot found in drawing contents")


@pytest.mark.parametrize("kind", charts.CHART_KINDS)
def test_each_kind_is_a_vector_drawing_with_labels_unit_and_legend(tmp_path, kind):
    d = charts.chart_drawing(
        kind,
        [S("Open", [3, 5, 2]), S("Closed", [1, 0, 4], "#0F8F76")],
        ["Crack", "Spalling", "Rust"],
        "findings",
        width=170 * mm,
        height=70 * mm,
        styles=ST,
    )
    assert (d.width, d.height) == (170 * mm, 70 * mm)
    path, data = _render(tmp_path, d)
    assert b"/Subtype /Image" not in data
    text = pdf_pages_text(path)[0]
    for word in ("Crack", "Spalling", "Rust", "findings", "Open", "Closed"):
        assert word in text


def test_no_series_or_all_none_prints_no_data(tmp_path):
    for series in ([], [S("x", [None, None])]):
        d = charts.chart_drawing("bar", series, ["a", "b"], "", width=100 * mm, height=50 * mm, styles=ST)
        path, _ = _render(tmp_path, d)
        assert "No data" in pdf_pages_text(path)[0]


def test_all_zero_bars_and_gappy_lines_render(tmp_path):
    # All-zero bars: a real chart, not the "No data" state, and the value axis gets a
    # sensible non-zero ceiling instead of collapsing to a zero-height plot. reportlab computes
    # the actual auto-ranged ceiling into `_valueMax` only once the drawing is rendered.
    bar = charts.chart_drawing("bar", [S("z", [0, 0])], ["a", "b"], "", width=300, height=150, styles=ST)
    bar_plot = _plot(bar)
    path, _ = _render(tmp_path, bar)
    assert bar_plot.valueAxis._valueMax == 1
    text = pdf_pages_text(path)[0]
    assert "a" in text and "b" in text
    assert "No data" not in text

    # Gappy line: the None in the middle is a genuine gap (not coerced to 0), so the axis
    # ranges over the real values 1 and 3, and the labels still print around the gap.
    line = charts.chart_drawing(
        "line", [S("g", [1, None, 3])], ["a", "b", "c"], "", width=300, height=150, styles=ST
    )
    line_plot = _plot(line)
    assert line_plot.data[0][1] is None
    path, _ = _render(tmp_path, line)
    assert line_plot.valueAxis._valueMax == 3
    text = pdf_pages_text(path)[0]
    for label in ("a", "b", "c"):
        assert label in text
    assert "No data" not in text


def test_many_categories_and_short_series_render(tmp_path):
    labels = [f"Survey {i}" for i in range(20)]
    d = charts.chart_drawing(
        "stacked_bar", [S("a", [1, 2])], labels, "m³", width=170 * mm, height=70 * mm, styles=ST
    )
    plot = _plot(d)
    path, _ = _render(tmp_path, d)
    # All 20 categories are kept, not truncated, and the short series (padded with 0 past
    # index 2) does not inflate the value axis beyond its real data max of 2.
    assert len(plot.categoryAxis.categoryNames) == 20
    assert plot.valueAxis._valueMax == 2
    text = pdf_pages_text(path)[0]
    assert "Survey 0" in text
    assert "Survey 19" in text


def test_unknown_kind_raises():
    with pytest.raises(ValueError, match="pie"):
        charts.chart_drawing("pie", [S("a", [1])], ["x"], "", width=100, height=100, styles=ST)
