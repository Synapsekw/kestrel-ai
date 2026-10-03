"""Report fonts (spec 2026-09-26-reports §5): static instances of Space Grotesk (Regular, Bold) and
JetBrains Mono (Regular), SIL OFL 1.1, cut from the Google Fonts variable TTFs by
scripts/fetch_report_fonts.py and committed with their licences. If registration fails (a broken
frozen build), the renderer prints in Helvetica/Courier and logs; it never fails the job.
`reports-selftest` (smoke_frozen.ps1) catches a missing font as "fonts 0"."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parents[1] / "fonts"
FACES: dict[str, str] = {
    "KestrelSans": "SpaceGrotesk-Regular.ttf",
    "KestrelSans-Bold": "SpaceGrotesk-Bold.ttf",
    "KestrelMono": "JetBrainsMono-Regular.ttf",
}
FONT_SHA256: dict[str, str] = {
    "SpaceGrotesk-Regular.ttf": "3da1d59fcfe5b66b0c6b41c437c564b6cdd110abdff5471e85e487aee336975a",
    "SpaceGrotesk-Bold.ttf": "23411dd0cd315863a71977321d8945a90b72c52ea8b1502b10d52ebc20dad031",
    "JetBrainsMono-Regular.ttf": "15e717083a6237478a91f8c7083a030d170d3e5d91718616f82f94806194e75f",
}


@dataclass(frozen=True)
class FontSet:
    sans: str
    sans_bold: str
    mono: str
    embedded: bool


EMBEDDED = FontSet("KestrelSans", "KestrelSans-Bold", "KestrelMono", True)
FALLBACK = FontSet("Helvetica", "Helvetica-Bold", "Courier", False)
_cache: dict[Path, FontSet] = {}


def register_fonts(font_dir: Path | None = None) -> FontSet:
    """Register the three faces once per folder; the FontSet to print with."""
    folder = Path(font_dir or FONT_DIR).resolve()
    if folder in _cache:
        return _cache[folder]
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        faces = [TTFont(name, str(folder / file)) for name, file in FACES.items()]
        for face in faces:
            pdfmetrics.registerFont(face)
        pdfmetrics.registerFontFamily(
            "KestrelSans",
            normal="KestrelSans",
            bold="KestrelSans-Bold",
            italic="KestrelSans",
            boldItalic="KestrelSans-Bold",
        )
        pdfmetrics.registerFontFamily(
            "KestrelMono",
            normal="KestrelMono",
            bold="KestrelMono",
            italic="KestrelMono",
            boldItalic="KestrelMono",
        )
        result = EMBEDDED
    except Exception as exc:  # a missing or corrupt font costs the typography, never the report
        log.warning("report fonts could not be registered from %s (%s); printing in Helvetica", folder, exc)
        result = FALLBACK
    _cache[folder] = result
    return result


def verify_fonts(font_dir: Path | None = None) -> int:
    """How many of the committed TTFs are present with their recorded sha256."""
    folder = Path(font_dir or FONT_DIR)
    ok = 0
    for name, sha in FONT_SHA256.items():
        try:
            ok += hashlib.sha256((folder / name).read_bytes()).hexdigest() == sha
        except OSError:
            continue
    return ok


THEME_SANS = "Space Grotesk"  # the theme's own family: KestrelSans, never a brand registration


def brand_fonts(text_family: str | None, numerals_family: str | None, base: FontSet) -> FontSet:
    """The brand's text family for body text and its numerals family (bold) for headings and figures,
    registered by D2 (`app.brands.fonts.register_family`). Falls back face by face to `base`."""
    if not base.embedded:
        return base
    from app.brands.fonts import register_family

    text = register_family(text_family) if text_family and text_family != THEME_SANS else None
    nums = register_family(numerals_family) if numerals_family and numerals_family != THEME_SANS else None
    sans = text[0] if text else base.sans
    bold = nums[1] if nums else (text[1] if text else base.sans_bold)
    return FontSet(sans, bold, base.mono, True)
