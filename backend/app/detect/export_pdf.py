"""The PDF report for one source (spec 2026-09-23 section 10, plan 2 unit E).

A4, reportlab platypus: a header (project, source, survey date, model and origin, confidence,
review progress), an overview image, the class table, the site-area table for a map, and a method
footnote that says what was counted. It is written from the same `SourceReport` as the CSV.

The overview is bounded: a map uses the preview written at import (at most 1024 px a side), and a
photo source a contact sheet of its first nine thumbnails. The full raster and the full photos are
never read.

Imported only by the `detect_export` job, never at app start: a missing reportlab in a broken build
costs the PDF, not the backend.
"""

from __future__ import annotations

import io
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select

from app.datasets import images
from app.db.models import Image as ImageRow
from app.detect.export_csv import SourceReport
from app.maps.startup import map_dir
from app.projects.service import ProjectHandle

CELL = 256  # a contact-sheet cell: the size thumbnails are written at
SHEET_COLUMNS = 3
SHEET_PHOTOS = 9
SHEET_BACKGROUND = (244, 244, 240)
MAX_OVERVIEW_W = 170 * mm
MAX_OVERVIEW_H = 110 * mm
RULE = colors.HexColor("#b8beb9")
HEAD_FILL = colors.HexColor("#eceee9")


def _fmt_conf(conf: float) -> str:
    return f"{conf:.2f}"


def _photos(n: int | None) -> str:
    return "1 photo" if n == 1 else f"{n or 0} photos"


def footnote(report: SourceReport) -> str:
    """What was counted and how, in plain words."""
    verified = "Verified means a person accepted or drew it."
    if report.kind == "map":
        model = report.run.model_name if report.run and report.run.model_name else "the model"
        conf = _fmt_conf(report.run.conf) if report.run else ""
        return (
            f"Counts are objects on the orthomosaic detected by {model} at confidence {conf} or higher; "
            f"rejected detections are not counted. {verified} A site area counts an object when the "
            "centre of its box lies inside the area."
        )
    return (
        f"Counts are detections across {_photos(report.image_count)}; the same object can appear in "
        f"several photos, so these are not object counts. {verified}"
    )


def overview_image(handle: ProjectHandle, report: SourceReport) -> PILImage.Image | None:
    """The map's preview, or a contact sheet of the source's first photos; None when neither exists."""
    if report.kind == "map":
        if not report.map_id:
            return None
        preview = map_dir(handle, report.map_id) / "preview.jpg"
        try:
            with PILImage.open(preview) as im:
                return im.convert("RGB")
        except OSError:
            return None
    with handle.session() as s:
        ids = list(
            s.execute(
                select(ImageRow.id)
                .where(ImageRow.source_id == report.source_id)
                .order_by(ImageRow.path)
                .limit(SHEET_PHOTOS)
            ).scalars()
        )
    thumbs: list[PILImage.Image] = []
    for image_id in ids:
        try:
            with PILImage.open(images.thumbnail(handle, image_id)) as im:
                thumbs.append(im.convert("RGB"))
        except Exception:  # a moved or unreadable photo just leaves its cell out
            continue
    if not thumbs:
        return None
    rows = -(-len(thumbs) // SHEET_COLUMNS)
    sheet = PILImage.new("RGB", (SHEET_COLUMNS * CELL, rows * CELL), SHEET_BACKGROUND)
    for i, thumb in enumerate(thumbs):
        thumb.thumbnail((CELL - 8, CELL - 8))
        col, row = i % SHEET_COLUMNS, i // SHEET_COLUMNS
        sheet.paste(thumb, (col * CELL + (CELL - thumb.width) // 2, row * CELL + (CELL - thumb.height) // 2))
    return sheet


def _image_flowable(image: PILImage.Image) -> Image:
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=85)
    buf.seek(0)
    scale = min(MAX_OVERVIEW_W / image.width, MAX_OVERVIEW_H / image.height)
    return Image(buf, width=image.width * scale, height=image.height * scale)


def _table(header: list[str], body: list[list[str]], widths: list[float]) -> Table:
    table = Table([header] + body, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BACKGROUND", (0, 0), (-1, 0), HEAD_FILL),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
                ("ALIGN", (-2, 0), (-1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def story(report: SourceReport, *, project_name: str, overview: PILImage.Image | None) -> list:
    """The report's flowables, in page order."""
    styles = getSampleStyleSheet()
    body, small, h1, h2 = styles["BodyText"], styles["Italic"], styles["Title"], styles["Heading2"]
    h1.alignment = 0  # left

    def para(text: str, style=body) -> Paragraph:
        return Paragraph(escape(text), style)

    run = report.run
    kind = "Map" if report.kind == "map" else "Photos"
    model = "No detection run yet"
    if run is not None:
        model = run.model_name or "Unnamed model"
        if report.model_origin:
            model += f" ({report.model_origin})"
    unit = report.unit
    flow: list = [
        para(report.label, h1),
        para(f"Project: {project_name}"),
        para(f"Source: {kind}" + (f", {_photos(report.image_count)}" if report.kind == "images" else "")),
        para(f"Survey date: {report.survey_date.isoformat() if report.survey_date else 'date not set'}"),
        para(f"Model: {model}"),
    ]
    if run is not None:
        flow.append(para(f"Confidence: {_fmt_conf(run.conf)} or higher"))
    flow.append(para(f"Review: {report.review.reviewed} of {report.review.total} reviewed"))
    flow.append(Spacer(1, 4 * mm))
    flow.append(
        _image_flowable(overview) if overview is not None else para("No overview image available.", small)
    )
    flow.append(Spacer(1, 4 * mm))

    flow.append(para(f"Counts ({unit})", h2))
    if report.classes:
        rows = [[c.name, str(c.total), str(c.verified)] for c in report.classes]
        flow.append(_table(["Class", "Total", "Verified"], rows, [90 * mm, 30 * mm, 30 * mm]))
    else:
        flow.append(para(f"No {unit} counted."))

    if report.kind == "map":
        flow.append(para("Site areas", h2))
        if report.areas:
            rows = []
            for area in report.areas:
                name = f"{area.name} (partly on this map)" if area.partial else area.name
                for c in area.classes or []:
                    rows.append([name, c.name, str(c.total), str(c.verified)])
                if not area.classes:
                    rows.append([name, "", "0", "0"])
            flow.append(
                _table(
                    ["Site area", "Class", "Total", "Verified"], rows, [60 * mm, 50 * mm, 25 * mm, 25 * mm]
                )
            )
        else:
            flow.append(para("No site area lies on this map."))

    flow.append(Spacer(1, 6 * mm))
    flow.append(para(footnote(report), small))
    return flow


def write(path: Path, report: SourceReport, *, project_name: str, overview: PILImage.Image | None) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"{report.label} - {project_name}",
        author="Kestrel AI",
    )
    doc.build(story(report, project_name=project_name, overview=overview))
