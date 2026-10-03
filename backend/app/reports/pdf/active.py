"""The theme one PDF build draws with (spec 2026-10-02-asset-findings §10): THEME, or a brand overlay
of it (D2's `with_brand`). `styles.colour` and the cover band read it, so no style call needs a theme
argument. `using` also points reportlab's default table cell font at the report's sans: a plain-string
cell otherwise references Helvetica, an unembedded standard font (the kit's "fonts embedded" rule).
document.render_pdf holds a lock around `using`, because the cell font is a process-wide default."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from reportlab.platypus import tables

from app.reports.theme import THEME

_THEME: ContextVar[dict] = ContextVar("report_pdf_theme", default=THEME)


def theme() -> dict:
    return _THEME.get()


@contextmanager
def using(theme_dict: dict, font: str) -> Iterator[None]:
    token = _THEME.set(theme_dict)
    old_font = tables.CellStyle.fontname
    tables.CellStyle.fontname = font
    try:
        yield
    finally:
        tables.CellStyle.fontname = old_font
        _THEME.reset(token)
