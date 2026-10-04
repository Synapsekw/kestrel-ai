"""The report brand (spec 2026-10-02-asset-findings §5.8, §10): `config.brand_id` resolved once per
render or outline into the theme overlay, the two font families, the logo files and the footer text.
No PDF library here (routers import it). A brand that cannot be read costs the brand, never the
report: the caller prints in the Kestrel theme and warns `brand_missing`."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.brands.store import confidentiality_line, get_brand, logo_path
from app.reports.theme import THEME, with_brand

log = logging.getLogger(__name__)
BRAND_MISSING = "The report brand could not be found, so the report prints in the Kestrel theme."


@dataclass(frozen=True)
class ResolvedBrand:
    id: str
    name: str
    theme: dict
    text_family: str
    numerals_family: str
    cover_logo: Path | None  # on_dark, bottom left of the cover band
    header_logo: Path | None  # flat (no alpha), else on_light, in the running header
    footer_left: str  # the confidentiality line, {year} and {customer} filled
    footer_right: str  # the website
    author: str


def resolve_brand(handle, config, generated_at: datetime) -> ResolvedBrand | None:
    brand_id = getattr(config, "brand_id", None)
    if not brand_id:
        return None
    cat = getattr(handle, "catalogue", None)
    try:
        row = get_brand(cat, brand_id)
        if row is None:
            return None
        theme = with_brand(THEME, row)
        cover = logo_path(cat, row.logo_on_dark)
        header = logo_path(cat, row.logo_flat) or logo_path(cat, row.logo_on_light)
        footer = confidentiality_line(row, generated_at.year, config.cover.client)
    except Exception:
        log.exception("brand %s could not be read; the report prints in the Kestrel theme", brand_id)
        return None
    fonts = theme["fonts"]
    return ResolvedBrand(
        id=row.id,
        name=row.name,
        theme=theme,
        text_family=fonts["sans"],
        numerals_family=fonts.get("numerals", fonts["sans"]),
        cover_logo=cover,
        header_logo=header,
        footer_left=footer,
        footer_right=row.website or "",
        author=row.pdf_author or row.owner or "Kestrel AI",
    )
