"""Page furniture for the report PDF (spec 2026-09-26-reports §10.1, §10.3, §10.4): the
`_NumberedCanvas` idiom of volumes/report_pdf.py generalised. Every page's state is kept until save()
so "page n / N" can be drawn once N is known; `page_offset`/`total_pages` continue the numbering
across parts. The /CreationDate is document.generated_at (reportlab's invariant mode alone would stamp
2000-01-01)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas

from app.reports.pdf.styles import Styles, colour
from app.reports.theme import THEME


def pdf_date(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("D:%Y%m%d%H%M%S+00'00'")


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
    canv.saveState()
    canv.setFont(styles.fonts.sans_bold if override else styles.fonts.sans, size)
    canv.setFillColor(colour("ink") if override else colour("muted"))
    canv.drawString(m, h - off, override or meta.title)
    canv.setFont(styles.fonts.sans, size)
    canv.setFillColor(colour("muted"))
    canv.drawRightString(w - m, h - off, meta.version_label)
    canv.setStrokeColor(colour("rule"))
    canv.setLineWidth(0.5)
    canv.line(m, h - off - 2 * mm, w - m, h - off - 2 * mm)
    who = f"Kestrel AI · {meta.project}" if meta.project else "Kestrel AI"
    canv.drawRightString(w - m, off, f"{who} · page {local + meta.page_offset} / {total}")
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
