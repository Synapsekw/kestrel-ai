"""Shared PDF scans and the branded-render fixtures for the report PDF tests (R1 Tasks 8, 10, 11).
A helper module, so no test module is imported by another."""

from __future__ import annotations

import re
from types import SimpleNamespace

from PIL import Image
from report_pdf_helpers import pdf_pages_text

from app.reports.brand import ResolvedBrand
from app.reports.theme import THEME, with_brand

ROW = SimpleNamespace(
    colors={
        "accent": "#BC0000",
        "accent_dark": "#9E0000",
        "navy": "#141D2D",
        "ink": "#1A1A1A",
        "pale": "#FFE5E5",
        "line": "#E7E4DE",
    },
    font_text="Nunito Sans",
    font_numerals="Poppins",
)


def brand(tmp_path, *, logos: bool = True) -> ResolvedBrand:
    logo = tmp_path / "logo.png"
    Image.new("RGBA", (400, 160), (230, 20, 20, 200)).save(logo)  # translucent: must not make an SMask
    theme = with_brand(THEME, ROW)
    return ResolvedBrand(
        id="b-test",
        name="Example Co",
        theme=theme,
        text_family=theme["fonts"]["sans"],
        numerals_family=theme["fonts"]["numerals"],
        cover_logo=logo if logos else None,
        header_logo=logo if logos else None,
        footer_left="© 2026 Example Co. For the recipient only.",
        footer_right="www.example.com",
        author="Example Drones",
    )


def dash_chars(path) -> list[str]:
    """Every em or en dash the PDF's text layer holds (the kit rule: none)."""
    return re.findall("[–—]", "".join(pdf_pages_text(path)))


def font_names(path) -> set[bytes]:
    return set(re.findall(rb"/BaseFont /([\w+-]+)", path.read_bytes()))


def unembedded_fonts(path) -> list[bytes]:
    """BaseFont names without a subset prefix (ABCDEF+Name), i.e. not embedded."""
    return sorted(n for n in font_names(path) if b"+" not in n)


def smask_count(path) -> int:
    """Raw byte scan: reportlab writes no object streams, so it sees every object dictionary."""
    return path.read_bytes().count(b"/SMask")
