"""Paragraph and table styles for the report PDF (spec 2026-09-26-reports §10.1), all from THEME."""

from __future__ import annotations

import re
from dataclasses import dataclass

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import TableStyle

from app.reports.pdf import active
from app.reports.pdf.fonts import FontSet
from app.reports.theme import THEME

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
TONES = {"neutral": "tone_neutral", "good": "tone_good", "bad": "tone_bad", "warn": "tone_warn"}


def colour(name: str) -> colors.Color:
    return colors.HexColor(active.theme()["colours"][name])


def safe_colour(value: object, fallback: str = "ungraded") -> colors.Color:
    """A colour carried by the data (type, severity): `#RRGGBB`, else the theme's fallback."""
    if isinstance(value, str) and _HEX.match(value):
        return colors.HexColor(value)
    return colour(fallback)


def tint(c: colors.Color, amount: float) -> colors.Color:
    """`amount` of `c` over white (a 12 % pill is tint(c, 0.12))."""
    return colors.Color(1 - (1 - c.red) * amount, 1 - (1 - c.green) * amount, 1 - (1 - c.blue) * amount)


@dataclass(frozen=True)
class Styles:
    fonts: FontSet
    body: ParagraphStyle
    small: ParagraphStyle
    note: ParagraphStyle
    caption: ParagraphStyle
    h1: ParagraphStyle
    h2: ParagraphStyle
    h3: ParagraphStyle
    mono: ParagraphStyle
    cell: ParagraphStyle
    cell_mono: ParagraphStyle
    cell_head: ParagraphStyle
    cell_label: ParagraphStyle
    kpi_value: ParagraphStyle
    kpi_label: ParagraphStyle
    kpi_delta: ParagraphStyle
    cover_title: ParagraphStyle
    cover_subtitle: ParagraphStyle
    comment_meta: ParagraphStyle
    comment: ParagraphStyle


def build_styles(fonts: FontSet) -> Styles:
    t = THEME["type"]
    ink, muted = colour("ink"), colour("muted")

    def ps(
        name: str, font: str, size: float, leading: float | None = None, color=ink, **kw
    ) -> ParagraphStyle:
        return ParagraphStyle(
            f"k-{name}",
            fontName=font,
            fontSize=size,
            leading=leading or round(size * 1.3, 1),
            textColor=color,
            **kw,
        )

    return Styles(
        fonts=fonts,
        body=ps("body", fonts.sans, t["body_pt"], t["body_leading_pt"], spaceAfter=2 * mm),
        small=ps("small", fonts.sans, t["small_pt"], color=muted),
        note=ps("note", fonts.sans, t["note_pt"], leftIndent=3 * mm, spaceAfter=2 * mm),
        caption=ps("caption", fonts.sans, t["small_pt"], color=muted, spaceBefore=1 * mm),
        h1=ps("h1", fonts.sans_bold, t["h1_pt"], spaceBefore=2 * mm, spaceAfter=4 * mm),
        h2=ps("h2", fonts.sans_bold, t["h2_pt"], spaceBefore=4 * mm, spaceAfter=3 * mm),
        h3=ps("h3", fonts.sans_bold, t["h3_pt"], spaceBefore=3 * mm, spaceAfter=2 * mm),
        mono=ps("mono", fonts.mono, t["mono_pt"]),
        cell=ps("cell", fonts.sans, t["mono_pt"]),
        cell_mono=ps("cell-mono", fonts.mono, t["mono_pt"], alignment=TA_RIGHT),
        cell_head=ps("cell-head", fonts.sans_bold, t["mono_pt"]),
        cell_label=ps("cell-label", fonts.sans, t["mono_pt"], color=muted),
        kpi_value=ps("kpi-value", fonts.sans_bold, t["kpi_value_pt"]),
        kpi_label=ps("kpi-label", fonts.sans, t["small_pt"], color=muted),
        kpi_delta=ps("kpi-delta", fonts.sans, t["small_pt"], color=colour("tone_neutral")),
        cover_title=ps("cover-title", fonts.sans_bold, THEME["cover"]["title_pt"], color=colors.white),
        cover_subtitle=ps("cover-subtitle", fonts.sans, THEME["cover"]["subtitle_pt"], color=colors.white),
        comment_meta=ps("comment-meta", fonts.sans, t["small_pt"], color=muted, spaceBefore=1.5 * mm),
        comment=ps("comment", fonts.sans, t["note_pt"]),
    )


def tone_style(styles: Styles, tone: object) -> ParagraphStyle:
    key = TONES.get(str(getattr(tone, "value", tone)), "tone_neutral")
    return ParagraphStyle(f"k-delta-{key}", parent=styles.kpi_delta, textColor=colour(key))


def table_style(*, header: bool) -> TableStyle:
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colour("rule")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        cmds.append(("BACKGROUND", (0, 0), (-1, 0), colour("head_fill")))
    return TableStyle(cmds)
