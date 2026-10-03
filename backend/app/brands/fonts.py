"""Brand fonts (spec 2026-10-02-asset-findings §5.8): Nunito Sans, Poppins and Inter, SIL OFL 1.1,
cut from the Google Fonts repository by scripts/fetch_brand_fonts.py and committed with their
licences, like the report fonts (app/reports/pdf/fonts.py).

A brand stores a family name (`Brand.font_text`, `Brand.font_numerals`). R1 calls `register_family`
when it prints with a brand; a missing or corrupt file costs that brand its typography (the theme
font prints instead), never the report. No reportlab import at module scope: the brands router
imports this module.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent / "fonts"


@dataclass(frozen=True)
class BrandFontFiles:
    regular: str
    bold: str
    licence: str


FAMILIES: dict[str, BrandFontFiles] = {
    "Nunito Sans": BrandFontFiles("NunitoSans-Regular.ttf", "NunitoSans-Bold.ttf", "OFL-NunitoSans.txt"),
    # The kit's numerals weights are 600 and 700: SemiBold is this family's "regular".
    "Poppins": BrandFontFiles("Poppins-SemiBold.ttf", "Poppins-Bold.ttf", "OFL-Poppins.txt"),
    "Inter": BrandFontFiles("Inter-Regular.ttf", "Inter-Bold.ttf", "OFL-Inter.txt"),
}
FONT_SHA256: dict[str, str] = {
    "NunitoSans-Regular.ttf": "6dcfd135eb447ccfc6ec0367d7a6a72a7214903c47b7fdd6c06fada407b88ee7",
    "NunitoSans-Bold.ttf": "5ee407544cd6e9da1480f83fd94ee28f1626d3ae0c1ac6e11ca72a7e0f78756a",
    "Poppins-SemiBold.ttf": "d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286",
    "Poppins-Bold.ttf": "983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c",
    "Inter-Regular.ttf": "0b59f6b6fc9e8a9ad8032802d1797c4237d9288a3e7b7661517070627b577060",
    "Inter-Bold.ttf": "202f240469f916722233188ec316107f6cecaf13b801e9b3939b82b9f7a816d6",
}
_registered: dict[tuple[Path, str], tuple[str, str] | None] = {}


def font_files(family: str | None, font_dir: Path | None = None) -> tuple[Path, Path] | None:
    """The regular and bold TTF of a bundled family, or None (no family, not bundled, file missing)."""
    files = FAMILIES.get(family or "")
    if files is None:
        return None
    folder = Path(font_dir or FONT_DIR)
    regular, bold = folder / files.regular, folder / files.bold
    return (regular, bold) if regular.is_file() and bold.is_file() else None


def _face(family: str) -> str:
    return "Brand-" + family.replace(" ", "")


def register_family(family: str | None, font_dir: Path | None = None) -> tuple[str, str] | None:
    """Register a bundled family with reportlab once; its (regular, bold) face names, or None."""
    if family not in FAMILIES:
        return None
    folder = Path(font_dir or FONT_DIR).resolve()
    key = (folder, family)
    if key in _registered:
        return _registered[key]
    result: tuple[str, str] | None = None
    paths = font_files(family, folder)
    if paths is None:
        log.warning("brand font %s is missing from %s; printing in the theme font", family, folder)
    else:
        try:
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont

            regular, bold = _face(family), _face(family) + "-Bold"
            pdfmetrics.registerFont(TTFont(regular, str(paths[0])))
            pdfmetrics.registerFont(TTFont(bold, str(paths[1])))
            pdfmetrics.registerFontFamily(regular, normal=regular, bold=bold, italic=regular, boldItalic=bold)
            result = (regular, bold)
        except Exception as exc:  # a corrupt file costs the brand typography, never the report
            log.warning("brand font %s could not be registered from %s (%s)", family, folder, exc)
    _registered[key] = result
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
