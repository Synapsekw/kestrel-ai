"""The print theme (spec 2026-09-26-reports §10.1). Every colour and size of the PDF lives here, as
literals equal to contract/fixtures/report-theme.json (tests/test_reports_theme.py pins them; the
preview's printTheme.ts pins the same file). Literals, not a JSON read: contract/ is not in the frozen
bundle. No PDF-library import here, so routers may import this module; the brand overlay (`THEME["brand"]`,
`with_brand`) is owned by plan 2026-10-03-asset-findings-d2."""

from __future__ import annotations

import copy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.brands.store import BrandRow

THEME: dict = {
    "version": 1,
    "fonts": {"sans": "Space Grotesk", "mono": "JetBrains Mono"},
    "colours": {
        "ink": "#15142B",
        "muted": "#5E5C7A",
        "rule": "#DAD8EA",
        "head_fill": "#F3F1FC",
        "paper": "#FFFFFF",
        "violet": "#6A5CFF",
        "violet_print": "#8F7BFF",
        "teal": "#0F8F76",
        "teal_print": "#5FE3C0",
        "placeholder_fill": "#EEEDF5",
        "ungraded": "#9A98B0",
        "tone_neutral": "#5E5C7A",
        "tone_good": "#0F8F76",
        "tone_bad": "#B3261E",
        "tone_warn": "#8A5A00",
    },
    "cover": {
        "gradient": ["#3B2A7A", "#6A5CFF", "#0F5B66"],
        "band_fraction": 0.38,
        "title_pt": 30,
        "subtitle_pt": 12,
        "logo_chip_mm": [44, 22],
    },
    "type": {
        "body_pt": 9.5,
        "body_leading_pt": 13,
        "small_pt": 8,
        "note_pt": 9,
        "h1_pt": 18,
        "h2_pt": 14,
        "h3_pt": 11,
        "mono_pt": 8.5,
        "furniture_pt": 7.5,
        "kpi_value_pt": 16,
    },
    "page": {
        "margin_mm": 18,
        "furniture_offset_mm": 10,
        "radius_mm": 3,
        "sizes_mm": {"A4": [210, 297], "Letter": [215.9, 279.4]},
    },
    "severity": {"dot_mm": 2.2, "pill_tint": 0.12},
    "finding": {"main_mm": [170, 105], "secondary_mm": [83, 52], "photo_mm": [40, 30]},
    "chart": {
        "height_mm": 70,
        "palette": ["#6A5CFF", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
    },
    # Which theme value takes which brand colour (spec 2026-10-02-asset-findings §5.8). with_brand here
    # and withBrand in printTheme.ts both read this block; contract/fixtures/report-brand-overlay.json
    # pins their output.
    "brand": {
        "colours": {
            "ink": "ink",
            "rule": "line",
            "head_fill": "pale",
            "violet": "accent",
            "violet_print": "accent_dark",
        },
        "cover_gradient": ["navy", "navy", "accent_dark"],
        "chart_lead": "accent",
    },
}

THEME_VERSION: int = THEME["version"]


def with_brand(theme: dict, brand: BrandRow | None) -> dict:
    """`theme` with a brand's colours and fonts laid over it, as a new dict; `theme` is never changed.

    No brand: an equal copy (today's Kestrel theme). Fonts: `sans` is the brand's text font or the
    theme's, `numerals` is the brand's numerals font or that `sans`; R1 maps a family to embedded
    faces through app.brands.fonts.register_family."""
    out = copy.deepcopy(theme)
    if brand is None:
        return out
    rules = theme["brand"]
    colors = {key: value.upper() for key, value in brand.colors.items()}
    for key, source in rules["colours"].items():
        out["colours"][key] = colors[source]
    out["cover"]["gradient"] = [colors[key] for key in rules["cover_gradient"]]
    out["chart"]["palette"] = [colors[rules["chart_lead"]], *theme["chart"]["palette"][1:]]
    sans = brand.font_text or theme["fonts"]["sans"]
    out["fonts"] = {**theme["fonts"], "sans": sans, "numerals": brand.font_numerals or sans}
    return out
