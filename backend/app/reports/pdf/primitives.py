"""Small flowables the report PDF is built from (spec 2026-09-26-reports §10.1-§10.2).

A figure is drawn with canvas.drawImage on the cached JPEG, embedded as /DCTDecode without decoding
it, so a figure costs its file size, not its pixels. The XObject is a LazyJpeg: reportlab's own reads
the file at draw time, ASCII85-inflated (x1.25), and holds it for the whole build, so with save()'s two
formatted copies a part peaked at ~4x its embedded JPEG (spec §15); a LazyJpeg reads the file only
while save() writes it, binary. Only the JPEG header is read here (for the aspect ratio). Anything
missing or unreadable prints as a grey placeholder with the reason, never an error (spec §16).

`figure_flowable` returns a one-column Table (an atomic flowable), not a KeepTogether: Tasks 10 and
11 place it inside other Table cells, and a KeepTogether inside a Table cell raises LayoutError on
reportlab 5.0.1 (controller ruling P1). The Table still keeps the image (or placeholder) and its
caption together, the same as KeepTogether would."""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.units import mm
from reportlab.lib.utils import _digester, simpleSplit
from reportlab.pdfbase import pdfdoc, pdfutils
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable, Paragraph, Table, TableStyle

from app.reports.pdf.flowables_text import text
from app.reports.pdf.styles import Styles, colour, safe_colour, tint
from app.reports.theme import THEME

log = logging.getLogger(__name__)
RADIUS = THEME["page"]["radius_mm"] * mm
CAPTION_CHARS = 300  # a caption sits in an atomic Table with its figure: uncapped it can outgrow a page


def fit_box(px_w: int, px_h: int, box_w: float, box_h: float) -> tuple[float, float]:
    scale = min(box_w / px_w, box_h / px_h)
    return round(px_w * scale, 4), round(px_h * scale, 4)


class LazyJpeg(pdfdoc.PDFImageXObject):
    """A JPEG image XObject that holds only its path and header until the PDF is written."""

    def __init__(self, name: str, path: Path):
        self.name, self.path, self.mask = name, Path(path), None
        with self.path.open("rb") as f:
            self.width, self.height, components = pdfutils.readJPEGInfo(f)[:3]
        self.bitsPerComponent = 8
        self.colorSpace = {1: "DeviceGray", 3: "DeviceRGB"}.get(components, "DeviceCMYK")
        self._dotrans = int(components == 4)
        self._filters = ("DCTDecode",)

    def format(self, document):
        self.streamContent = self.path.read_bytes()
        try:
            return super().format(document)
        finally:
            del self.streamContent


def draw_jpeg(c, path: Path, x: float, y: float, width: float, height: float) -> None:
    """canvas.drawImage of a JPEG through a LazyJpeg: registered under the name drawImage derives from
    the path, so drawImage finds it and draws it, and a repeat of the path reuses it."""
    name = _digester(f"{path}{None}".encode())
    reg = c._doc.getXObjectName(name)
    if c._doc.idToObject.get(reg) is None:
        obj = LazyJpeg(name, path)
        c._setXObjects(obj)
        c._doc.Reference(obj, reg)
        c._doc.addForm(name, obj)
    c.drawImage(str(path), x, y, width, height)


class FramedImage(Flowable):
    def __init__(self, path: Path, width: float, height: float):
        super().__init__()
        self.path, self.width, self.height = path, width, height
        self.hAlign = "CENTER"

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        clip = c.beginPath()
        clip.roundRect(0, 0, self.width, self.height, RADIUS)
        c.clipPath(clip, stroke=0, fill=0)
        draw_jpeg(c, self.path, 0, 0, self.width, self.height)
        c.restoreState()
        c.saveState()
        c.setStrokeColor(colour("rule"))
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, self.height, RADIUS, stroke=1, fill=0)
        c.restoreState()


class Placeholder(Flowable):
    def __init__(self, width: float, height: float, reason: str, styles: Styles):
        super().__init__()
        self.width, self.height, self.reason, self.font = width, height, reason, styles.fonts.sans
        self.hAlign = "CENTER"

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(colour("placeholder_fill"))
        c.setStrokeColor(colour("rule"))
        c.roundRect(0, 0, self.width, self.height, RADIUS, stroke=1, fill=1)
        c.setFillColor(colour("muted"))
        c.setFont(self.font, 8)
        lines = simpleSplit(self.reason, self.font, 8, max(self.width - 8 * mm, 10))
        y = self.height / 2 + (len(lines) - 1) * 5 - 3
        for line in lines:
            c.drawCentredString(self.width / 2, y, line)
            y -= 10
        c.restoreState()


class SeverityTag(Flowable):
    """A 12 % tinted pill with a filled dot and the word in ink: never colour alone (spec §10.1)."""

    def __init__(self, label: str, colour_hex: str | None, styles: Styles, size: float = 8.5):
        super().__init__()
        self.label, self.size, self.font = label, size, styles.fonts.sans
        self.fill = safe_colour(colour_hex)
        self.dot = THEME["severity"]["dot_mm"] * mm
        self.pad = 2 * mm

    def wrap(self, aw, ah):
        text_w = stringWidth(self.label, self.font, self.size)
        self.width = self.pad * 2 + self.dot + 1.5 * mm + text_w
        self.height = self.size + 5
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(tint(self.fill, THEME["severity"]["pill_tint"]))
        c.roundRect(0, 0, self.width, self.height, self.height / 2, stroke=0, fill=1)
        c.setFillColor(self.fill)
        c.circle(self.pad + self.dot / 2, self.height / 2, self.dot / 2, stroke=0, fill=1)
        c.setFillColor(colour("ink"))
        c.setFont(self.font, self.size)
        c.drawString(self.pad + self.dot + 1.5 * mm, (self.height - self.size * 0.7) / 2, self.label)
        c.restoreState()


_FIGURE_STYLE_NO_CAPTION = TableStyle(
    [
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
)
_FIGURE_STYLE_WITH_CAPTION = TableStyle(
    [
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 1 * mm),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
)


def figure_flowable(
    path: Path | None, width: float, height: float, caption: str, styles: Styles, *, reason: str | None = None
) -> Flowable:
    body: Flowable
    if path is None or not Path(path).is_file():
        body = Placeholder(width, height, reason or "Snapshot unavailable", styles)
    else:
        try:
            with PILImage.open(path) as im:
                px_w, px_h = im.size
                if im.format != "JPEG":
                    raise OSError(f"not a JPEG ({im.format})")
            w, h = fit_box(px_w, px_h, width, height)
            body = FramedImage(Path(path), w, h)
        except Exception as exc:  # truncated or foreign file: a placeholder, never a failed render
            log.warning("snapshot %s unreadable: %s", path, exc)
            body = Placeholder(width, height, "Snapshot unreadable", styles)
    rows: list[list[Flowable]] = [[body]]
    if caption:
        rows.append([Paragraph(text(caption, CAPTION_CHARS), styles.caption)])
    # An atomic Table, not a KeepTogether (controller ruling P1): later tasks place this inside
    # other Table cells, and a KeepTogether there raises LayoutError on reportlab 5.0.1.
    table = Table(rows, colWidths=[width], hAlign="CENTER")
    table.setStyle(_FIGURE_STYLE_WITH_CAPTION if caption else _FIGURE_STYLE_NO_CAPTION)
    return table
