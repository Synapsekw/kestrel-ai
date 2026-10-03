"""Page furniture for the report PDF (spec 2026-09-26-reports §10.1, §10.3, §10.4): the
`_NumberedCanvas` idiom of volumes/report_pdf.py generalised. Every page's state is kept until save()
so "page n / N" can be drawn once N is known; `page_offset`/`total_pages` continue the numbering
across parts. The /CreationDate is document.generated_at (reportlab's invariant mode alone would stamp
2000-01-01)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

from app.reports.pdf.flowables_text import undash
from app.reports.pdf.styles import Styles, colour
from app.reports.theme import THEME

log = logging.getLogger(__name__)


def pdf_date(dt: datetime) -> str:
    """A naive datetime is taken as UTC: astimezone would read it as machine-local time."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("D:%Y%m%d%H%M%S+00'00'")


HEADER_GAP_MM = 4  # between the header title and the version label


def fit_width(s: str, font: str, size: float, width: float) -> str:
    """`s`, or its longest prefix plus "…" that fits `width` (binary search on the prefix length)."""
    if stringWidth(s, font, size) <= width:
        return s
    lo, hi = 0, len(s)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if stringWidth(s[:mid].rstrip() + "…", font, size) <= width:
            lo = mid
        else:
            hi = mid - 1
    return s[:lo].rstrip() + "…"


@dataclass
class PageMeta:
    title: str
    version_label: str
    project: str
    generated_at: datetime
    page_offset: int = 0
    total_pages: int | None = None
    cover_pages: frozenset[int] = frozenset()
    header_overrides: dict[int, str] = field(default_factory=dict)
    page_count: int = 0


def _furniture(canv: rl_canvas.Canvas, meta: PageMeta, styles: Styles, local: int, total: int) -> None:
    w, h = canv._pagesize
    m = THEME["page"]["margin_mm"] * mm
    off = THEME["page"]["furniture_offset_mm"] * mm
    size = THEME["type"]["furniture_pt"]
    override = meta.header_overrides.get(local)
    head_font = styles.fonts.sans_bold if override else styles.fonts.sans
    room = w - 2 * m - stringWidth(meta.version_label, styles.fonts.sans, size) - HEADER_GAP_MM * mm
    canv.saveState()
    canv.setFont(head_font, size)
    canv.setFillColor(colour("ink") if override else colour("muted"))
    canv.drawString(m, h - off, fit_width(undash(override or meta.title), head_font, size, room))
    canv.setFont(styles.fonts.sans, size)
    canv.setFillColor(colour("muted"))
    canv.drawRightString(w - m, h - off, meta.version_label)
    canv.setStrokeColor(colour("rule"))
    canv.setLineWidth(0.5)
    canv.line(m, h - off - 2 * mm, w - m, h - off - 2 * mm)
    who = f"Kestrel AI · {meta.project}" if meta.project else "Kestrel AI"
    canv.drawRightString(w - m, off, undash(f"{who} · page {local + meta.page_offset} / {total}"))
    canv.restoreState()


def canvas_class(meta: PageMeta, styles: Styles) -> type[rl_canvas.Canvas]:
    class NumberedCanvas(rl_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_pages: list[dict] = []
            self.setDateFormatter(lambda *_: pdf_date(meta.generated_at))

        def showPage(self):  # noqa: N802 - reportlab's name
            self._saved_pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            meta.page_count = len(self._saved_pages)
            total = meta.total_pages or meta.page_count
            for state in self._saved_pages:
                self.__dict__.update(state)
                if self._pageNumber not in meta.cover_pages:
                    _furniture(self, meta, styles, self._pageNumber, total)
                super().showPage()
            super().save()

    return NumberedCanvas


def band_height(page_h: float) -> float:
    return page_h * THEME["cover"]["band_fraction"]


def draw_cover_band(canv: rl_canvas.Canvas, logo_path: Path | None) -> None:
    """The cover's full-bleed band: a linear gradient through the three stops of THEME["cover"],
    clipped to the top 38 % of the page, and the logo top right on a white rounded chip."""
    w, h = canv._pagesize
    y0 = h - band_height(h)
    stops = [colors.HexColor(c) for c in THEME["cover"]["gradient"]]
    canv.saveState()
    clip = canv.beginPath()
    clip.rect(0, y0, w, h - y0)
    canv.clipPath(clip, stroke=0, fill=0)
    canv.linearGradient(0, h, w, y0, stops, (0, 0.5, 1), extend=False)
    canv.restoreState()
    if logo_path is None:
        return
    m = THEME["page"]["margin_mm"] * mm
    cw, ch = (v * mm for v in THEME["cover"]["logo_chip_mm"])
    x, y, pad = w - m - cw, h - m - ch, 2 * mm
    canv.saveState()
    try:
        canv.setFillColor(colors.white)
        canv.roundRect(x, y, cw, ch, THEME["page"]["radius_mm"] * mm, stroke=0, fill=1)
        canv.drawImage(
            str(logo_path),
            x + pad,
            y + pad,
            cw - 2 * pad,
            ch - 2 * pad,
            preserveAspectRatio=True,
            anchor="c",
            mask="auto",
        )
    except Exception as exc:  # a bad logo costs the logo, never the report
        log.warning("cover logo %s could not be drawn: %s", logo_path, exc)
    finally:
        canv.restoreState()
