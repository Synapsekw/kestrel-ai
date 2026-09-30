"""Charts for the report PDF (spec 2026-09-26-reports §10.2): reportlab.graphics drawings, vector, so
they print sharp and cost no image bytes. Series colours come from the data, else the theme palette."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib.units import mm

from app.reports.pdf.styles import Styles, colour, safe_colour
from app.reports.theme import THEME

CHART_KINDS = ("bar", "stacked_bar", "line")
PALETTE = THEME["chart"]["palette"]


@dataclass(frozen=True)
class ChartSeries:
    name: str
    values: Sequence[float | None]
    colour: str | None = None


def _series_colour(s: ChartSeries, i: int):
    return safe_colour(s.colour, "violet") if s.colour else safe_colour(PALETTE[i % len(PALETTE)])


def chart_drawing(
    kind: str,
    series: Sequence[ChartSeries],
    x_labels: Sequence[str],
    unit: str,
    *,
    width: float,
    height: float,
    styles: Styles,
) -> Drawing:
    if kind not in CHART_KINDS:
        raise ValueError(f"unknown chart kind {kind!r}")
    font, muted, rule = styles.fonts.sans, colour("muted"), colour("rule")
    d = Drawing(width, height)
    n = len(x_labels)
    rows = [[*list(s.values)[:n], *([None] * max(0, n - len(s.values)))] for s in series]
    if not rows or n == 0 or all(v is None for r in rows for v in r):
        d.add(
            String(
                width / 2,
                height / 2,
                "No data",
                fontName=font,
                fontSize=9,
                fillColor=muted,
                textAnchor="middle",
            )
        )
        return d
    legend_h = 8 * mm if len(series) > 1 else 0
    plot = HorizontalLineChart() if kind == "line" else VerticalBarChart()
    plot.x, plot.y = 12 * mm, 10 * mm + legend_h
    plot.width, plot.height = width - 16 * mm, height - plot.y - 7 * mm
    if kind == "line":
        plot.data = [tuple(r) for r in rows]
        for i, s in enumerate(series):
            plot.lines[i].strokeColor = _series_colour(s, i)
            plot.lines[i].strokeWidth = 1.5
    else:
        plot.data = [tuple(0.0 if v is None else float(v) for v in r) for r in rows]
        if kind == "stacked_bar":
            plot.categoryAxis.style = "stacked"
        for i, s in enumerate(series):
            plot.bars[i].fillColor = _series_colour(s, i)
            plot.bars[i].strokeColor = None
        plot.valueAxis.valueMin = 0
    top = max((v for r in rows for v in r if v is not None), default=0)
    if top <= 0:
        plot.valueAxis.valueMax = 1
    plot.categoryAxis.categoryNames = [str(x) for x in x_labels]
    for axis in (plot.categoryAxis, plot.valueAxis):
        axis.labels.fontName, axis.labels.fontSize, axis.labels.fillColor = font, 7, muted
        axis.strokeColor = rule
    if n > 8:
        plot.categoryAxis.labels.angle = 30
        plot.categoryAxis.labels.boxAnchor = "ne"
    plot.valueAxis.visibleGrid = 1
    plot.valueAxis.gridStrokeColor = rule
    plot.valueAxis.gridStrokeWidth = 0.25
    d.add(plot)
    if unit:
        d.add(String(plot.x, height - 4 * mm, unit, fontName=font, fontSize=7, fillColor=muted))
    if legend_h:
        lg = Legend()
        lg.x, lg.y, lg.boxAnchor = plot.x, 3 * mm, "sw"
        lg.columnMaximum, lg.deltax, lg.dx, lg.dy, lg.dxTextSpace = 1, 30 * mm, 6, 6, 3
        lg.fontName, lg.fontSize, lg.fillColor = font, 7, colour("ink")
        lg.colorNamePairs = [(_series_colour(s, i), s.name) for i, s in enumerate(series)]
        d.add(lg)
    return d
