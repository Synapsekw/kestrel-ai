"""Self-contained HTML report: one file, no external requests (spec G2).

Every thumbnail is drawn with Pillow and inlined as a base64 JPEG; every text value is escaped
with `html.escape`. More than `MAX_CARDS` images with boxes: the first ones (by path) get a card,
the rest are left to the CSV. An unreviewed proposal is drawn with a dashed outline and a "?"
after its class name, so nobody mistakes it for a confirmed label; an image whose only boxes are
unreviewed does not count as "checked" (nobody has actually reviewed it yet).
"""

from __future__ import annotations

import base64
import html
import io
import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw

from app.exports.rows import ExportBox, ExportImage

MAX_SIDE = 640
MAX_CARDS = 300
REPORT_NAME = "report.html"

ThumbnailFn = Callable[[ExportImage], "bytes | None"]

log = logging.getLogger(__name__)


def _hex_to_rgb(colour: str) -> tuple[int, int, int]:
    c = colour.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _dashed_rectangle(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    colour: tuple[int, int, int],
    width: int = 2,
    dash: float = 6,
    gap: float = 4,
) -> None:
    """An unreviewed proposal's outline: a solid `rectangle()` would look identical to ground truth."""
    x0, x1 = sorted((box[0], box[2]))
    y0, y1 = sorted((box[1], box[3]))
    x = x0
    while x < x1:
        end = min(x + dash, x1)
        draw.line([(x, y0), (end, y0)], fill=colour, width=width)
        draw.line([(x, y1), (end, y1)], fill=colour, width=width)
        x += dash + gap
    y = y0
    while y < y1:
        end = min(y + dash, y1)
        draw.line([(x0, y), (x0, end)], fill=colour, width=width)
        draw.line([(x1, y), (x1, end)], fill=colour, width=width)
        y += dash + gap


def draw_thumbnail(
    path: Path,
    boxes: list[ExportBox],
    classes: list[dict],
    width: int,
    height: int,
    max_side: int = MAX_SIDE,
) -> bytes | None:
    """Opens `path`, draws `boxes` in their class colours, returns a JPEG capped at `max_side`.

    `width`/`height` are the image's stored size, not necessarily the decoded one: `Image.draft`
    (a JPEG-only, integer-factor fast path) may hand back a smaller decode than the file's real
    size, and box coordinates are always in the stored pixel space, so scaling from the stored size
    to whatever `draft` actually produced is what keeps a box aligned with its object. An unreadable
    or corrupt file is logged and skipped (returns None) rather than failing the whole export.
    """
    if not path.is_file():
        return None
    try:
        with PILImage.open(path) as src:
            src.draft("RGB", (max_side, max_side))
            im = src.convert("RGB")
    except Exception as e:  # a single bad image (truncated, unsupported) must not fail the export
        log.warning("could not read %s for a report thumbnail, showing the card without one: %s", path, e)
        return None

    scale_x = (im.width / width) if width else 1.0
    scale_y = (im.height / height) if height else 1.0
    longest = max(im.width, im.height) or 1
    fit = min(1.0, max_side / longest)
    final_size = (max(1, round(im.width * fit)), max(1, round(im.height * fit)))
    if final_size != im.size:
        im = im.resize(final_size)
    total_x, total_y = scale_x * fit, scale_y * fit

    colour_by_id = {c["id"]: _hex_to_rgb(c["colour"]) for c in classes}
    name_by_id = {c["id"]: c["name"] for c in classes}
    draw = ImageDraw.Draw(im)
    for box in boxes:
        colour = colour_by_id.get(box.class_id, (255, 0, 0))
        x0, y0 = box.x * total_x, box.y * total_y
        x1, y1 = (box.x + box.w) * total_x, (box.y + box.h) * total_y
        label = name_by_id.get(box.class_id, box.class_id)
        if box.review_state == "unreviewed":
            _dashed_rectangle(draw, (x0, y0, x1, y1), colour)
            label = f"{label} ?"
        else:
            draw.rectangle([x0, y0, x1, y1], outline=colour, width=2)
        draw.text((x0 + 2, max(0, y0 - 11)), label, fill=colour)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _class_counts(boxes: list[ExportBox], class_names: list[str]) -> dict[str, int]:
    counts = dict.fromkeys(class_names, 0)
    for b in boxes:
        if b.class_name in counts:
            counts[b.class_name] += 1
    return counts


def _is_checked(image: ExportImage) -> bool:
    """Marked empty, or has at least one reviewed box; an unreviewed-only image was never looked at."""
    return image.marked_empty or any(b.review_state != "unreviewed" for b in image.boxes)


def _e(v: object) -> str:
    return html.escape(str(v))


def _format_export_time(dt: datetime) -> str:
    """`YYYY-MM-DD HH:MM` plus the UTC offset, e.g. `2026-09-19 17:53 UTC+03:00`."""
    base = dt.strftime("%Y-%m-%d %H:%M")
    offset = dt.strftime("%z")
    if not offset:
        return base
    sign, hh, mm = offset[0], offset[1:3], offset[3:5]
    return f"{base} UTC{sign}{hh}:{mm}"


def _totals_table(images: list[ExportImage], class_names: list[str]) -> str:
    totals = dict.fromkeys(class_names, 0)
    for image in images:
        for cls, n in _class_counts(image.boxes, class_names).items():
            totals[cls] += n
    rows = "".join(f"<tr><td>{_e(cls)}</td><td>{n}</td></tr>" for cls, n in totals.items())
    return f"<table><thead><tr><th>Class</th><th>Count</th></tr></thead><tbody>{rows}</tbody></table>"


def _group_table(images: list[ExportImage], class_names: list[str]) -> str:
    per_group: dict[str, dict[str, int]] = {}
    images_per_group: dict[str, int] = {}
    for image in images:
        images_per_group[image.group] = images_per_group.get(image.group, 0) + 1
        counts = per_group.setdefault(image.group, dict.fromkeys(class_names, 0))
        for cls, n in _class_counts(image.boxes, class_names).items():
            counts[cls] += n
    head = "".join(f"<th>{_e(c)}</th>" for c in class_names)
    body = []
    for group in sorted(per_group):
        counts = per_group[group]
        cells = "".join(f"<td>{counts[c]}</td>" for c in class_names)
        total = sum(counts.values())
        body.append(f"<tr><td>{_e(group)}</td><td>{images_per_group[group]}</td>{cells}<td>{total}</td></tr>")
    return (
        "<table><thead><tr><th>Group</th><th>Images</th>"
        f"{head}<th>Total</th></tr></thead><tbody>{''.join(body)}</tbody></table>"
    )


def _settings_text(settings: dict) -> str:
    formats = ", ".join(settings.get("formats") or [])
    unreviewed = "yes" if settings.get("include_unreviewed") else "no"
    return f"Formats: {_e(formats)}. Included unreviewed proposals: {_e(unreviewed)}."


def _card(image: ExportImage, class_names: list[str], thumbnail: bytes | None) -> str:
    counts = _class_counts(image.boxes, class_names)
    summary = ", ".join(f"{cls} {n}" for cls, n in counts.items() if n)
    img_tag = ""
    if thumbnail is not None:
        b64 = base64.b64encode(thumbnail).decode("ascii")
        img_tag = f'<img src="data:image/jpeg;base64,{b64}" alt="{_e(image.path)}">'
    return (
        '<div class="card">'
        f"<p class='path'>{_e(image.path)}</p>"
        f"<p class='counts'>{_e(summary)}</p>"
        f"{img_tag}"
        "</div>"
    )


_STYLE = (
    "body{font-family:sans-serif;background:#111;color:#eee;padding:16px}"
    "table{border-collapse:collapse;margin:8px 0}"
    "th,td{border:1px solid #555;padding:4px 8px;text-align:left}"
    ".cards{display:flex;flex-wrap:wrap;gap:12px}"
    ".card{border:1px solid #555;padding:8px;max-width:680px}"
    ".card img{max-width:640px;display:block}"
)


def write(
    images: list[ExportImage],
    classes: list[dict],
    folder: Path,
    *,
    project_name: str,
    export_time: datetime,
    settings: dict,
    image_root: Path | None = None,
    thumbnail_fn: ThumbnailFn | None = None,
    on_card: Callable[[int, int], None] | None = None,
) -> list[str]:
    """Writes one `report.html`. `thumbnail_fn` overrides the default (open + draw) thumbnail source."""
    folder.mkdir(parents=True, exist_ok=True)
    class_names = [c["name"] for c in classes]

    if thumbnail_fn is None:
        root = image_root

        def thumbnail_fn(image: ExportImage) -> bytes | None:
            if root is None:
                return None
            return draw_thumbnail(
                root / image.path, image.boxes, classes, image.width, image.height, MAX_SIDE
            )

    checked = [i for i in images if _is_checked(i)]
    with_machinery = [i for i in images if i.boxes]
    shown = with_machinery[:MAX_CARDS]
    has_unreviewed = any(b.review_state == "unreviewed" for i in images for b in i.boxes)

    cards = []
    for done, image in enumerate(shown, 1):
        cards.append(_card(image, class_names, thumbnail_fn(image)))
        if on_card:
            on_card(done, len(shown))

    overflow = ""
    if len(with_machinery) > MAX_CARDS:
        left_out = len(with_machinery) - MAX_CARDS
        overflow = (
            f"<p>{left_out} more image{'s' if left_out != 1 else ''} with machinery "
            "are not shown here; see detections.csv for all of them.</p>"
        )

    legend = ""
    if has_unreviewed:
        legend = '<p>A dashed box with "?" after the class name is an unreviewed proposal.</p>'

    parts = [
        "<!DOCTYPE html>",
        '<html><head><meta charset="utf-8">'
        f'<title>{_e(project_name)} — results export</title><style>{_STYLE}</style></head><body>',
        f"<h1>{_e(project_name)}</h1>",
        f"<p>Exported {_e(_format_export_time(export_time))}</p>",
        f"<p>{_settings_text(settings)}</p>",
        f"<p>{len(checked)} images checked, {len(with_machinery)} with machinery.</p>",
        legend,
        "<h2>Totals</h2>",
        _totals_table(images, class_names),
        "<h2>By group</h2>",
        _group_table(images, class_names),
        "<h2>Images</h2>",
        f'<div class="cards">{"".join(cards)}</div>',
        overflow,
        "</body></html>",
    ]
    (folder / REPORT_NAME).write_text("\n".join(parts), "utf-8")
    return [REPORT_NAME]
