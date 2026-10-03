"""AssetDrawing primitives as reportlab vector drawings (spec 2026-10-02-asset-findings §10). The
order and every offset equal frontend/src/reports/preview/blocks/AssetDrawingSvg.tsx, so the preview
matches the PDF. Drawing units are y down; the PDF is y up, so y flips once, in `Y`."""

from __future__ import annotations

from typing import Any

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer

from app.reports.pdf.flowables_text import text, undash
from app.reports.pdf.styles import Styles, colour, safe_colour


def drawing_flowable(d: Any, width: float, styles: Styles) -> Drawing:
    s = width / float(d.width)
    h = float(d.height) * s
    out = Drawing(width, h)
    out.initialFontName = styles.fonts.sans
    font, fs, p = styles.fonts.sans, float(d.font_size), d.plot
    ink, muted, rule = colour("ink"), colour("muted"), colour("rule")
    head, paper, fill = colour("head_fill"), colour("paper"), colour("placeholder_fill")

    def X(x: float) -> float:  # noqa: N802 - the SVG twin's names
        return float(x) * s

    def Y(y: float) -> float:  # noqa: N802
        return h - float(y) * s

    def label(x: float, y: float, value: str, size: float, fill_colour, anchor: str = "start") -> None:
        out.add(
            String(
                X(x),
                Y(y),
                undash(value),
                fontName=font,
                fontSize=size * s,
                fillColor=fill_colour,
                textAnchor=anchor,
            )
        )

    for b in d.bands:
        out.add(
            Rect(
                X(p.x0),
                Y(b.y1),
                (p.x1 - p.x0) * s,
                (b.y1 - b.y0) * s,
                fillColor=head if b.shaded else paper,
                strokeColor=None,
            )
        )
        label(p.x1 + fs * 0.8, (b.y0 + b.y1) / 2 + fs * 0.35, b.label, fs * 0.9, ink)
    for t in d.y_ticks:
        out.add(Line(X(p.x0), Y(t.at), X(p.x1), Y(t.at), strokeColor=rule, strokeWidth=0.5 * s))
        label(p.x0 - fs * 0.6, t.at + fs * 0.35, t.label, fs * 0.85, muted, "end")
    for t in d.x_ticks:
        out.add(
            Line(
                X(t.at),
                Y(p.y0),
                X(t.at),
                Y(p.y1),
                strokeColor=rule,
                strokeWidth=0.5 * s,
                strokeDashArray=[2 * s, 4 * s],
            )
        )
        label(t.at, p.y1 + fs * 1.3, t.label, fs * 0.9, ink, "middle")
    if len(d.silhouette) > 2:
        pts = [v for x, y in d.silhouette for v in (X(x), Y(y))]
        out.add(Polygon(pts, fillColor=fill, strokeColor=muted, strokeWidth=0.6 * s))
    for lv in d.levels:
        out.add(Line(X(lv.x0), Y(lv.y), X(lv.x1), Y(lv.y), strokeColor=muted, strokeWidth=0.5 * s))
    if d.marker is not None:
        m = d.marker
        out.add(
            Line(X(m.x0), Y(m.y), X(m.x1), Y(m.y), strokeColor=safe_colour(m.colour), strokeWidth=1.4 * s)
        )
    for dot in d.dots:
        out.add(
            Circle(
                X(dot.x),
                Y(dot.y),
                dot.r * s,
                fillColor=safe_colour(dot.colour),
                strokeColor=paper,
                strokeWidth=dot.r * 0.25 * s,
            )
        )
    if d.x_title:
        label((p.x0 + p.x1) / 2, d.height - fs * 0.3, d.x_title, fs * 0.85, muted, "middle")
    return out


def asset_map_flowables(block: Any, ctx: Any) -> list:
    st = ctx.styles
    out: list = [Paragraph(text(block.title), st.h3)] if block.title else []
    out.append(drawing_flowable(block.drawing, min(block.width_mm * mm, ctx.frame_width), st))
    if block.caption:
        out.append(Paragraph(text(block.caption), st.caption))
    return [*out, Spacer(1, 4 * mm)]
