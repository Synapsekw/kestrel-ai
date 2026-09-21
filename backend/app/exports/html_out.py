"""Self-contained HTML report: one file, no external requests (spec G2).

Every thumbnail is drawn with Pillow and inlined as a base64 JPEG; every text value is escaped
with `html.escape`. More than `MAX_CARDS` images with boxes: the first ones (by path) get a card,
the rest are left to the CSV. An unreviewed proposal is drawn with a dashed outline and a "?"
after its class name, so nobody mistakes it for a confirmed label.

The summary splits every image into four disjoint buckets: `confirmed` (an accepted/edited box),
`empty` (marked empty, with no accepted/edited box), `proposals_only` (only unreviewed boxes) and
`untouched` (nothing at all) — an image with only unreviewed proposals was never actually reviewed,
so it counts as neither confirmed nor empty.
"""

from __future__ import annotations

import base64
import html
import io
import logging
import math
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageDraw

from app.exports.rows import ExportBox, ExportImage, class_counts
from app.geometry import corners_of

MAX_SIDE = 640
MAX_CARDS = 300
REPORT_NAME = "report.html"

ThumbnailFn = Callable[[ExportImage], "bytes | None"]

log = logging.getLogger(__name__)


def _plural(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def _hex_to_rgb(colour: str) -> tuple[int, int, int]:
    c = colour.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _dashed_polygon(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    colour: tuple[int, int, int],
    width: int = 2,
    dash: float = 6,
    gap: float = 4,
) -> None:
    """An unreviewed proposal's outline: a solid polygon would look identical to ground truth."""
    for i, start in enumerate(points):
        end = points[(i + 1) % len(points)]
        span = math.dist(start, end)
        if span == 0:
            continue
        ux, uy = (end[0] - start[0]) / span, (end[1] - start[1]) / span
        travelled = 0.0
        while travelled < span:
            seg = min(dash, span - travelled)
            a = (start[0] + ux * travelled, start[1] + uy * travelled)
            b = (start[0] + ux * (travelled + seg), start[1] + uy * (travelled + seg))
            draw.line([a, b], fill=colour, width=width)
            travelled += dash + gap


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
        pts = [(px * total_x, py * total_y) for px, py in corners_of(box.x, box.y, box.w, box.h, box.angle)]
        label = name_by_id.get(box.class_id, box.class_id)
        if box.review_state == "unreviewed":
            _dashed_polygon(draw, pts, colour)
            label = f"{label} ?"
        else:
            draw.polygon(pts, outline=colour, width=2)
        anchor = min(pts, key=lambda p: p[1])
        draw.text((anchor[0] + 2, max(0, anchor[1] - 11)), label, fill=colour)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _bucket(image: ExportImage) -> str:
    """Which of four disjoint buckets `image` falls into, for the summary sentence (N3)."""
    if any(b.review_state in ("accepted", "edited") for b in image.boxes):
        return "confirmed"
    if image.marked_empty:
        return "empty"
    if image.boxes:  # only unreviewed ones remain: "confirmed" already claimed accepted/edited
        return "proposals_only"
    return "untouched"


def _summary_html(images: list[ExportImage]) -> str:
    counts = {"confirmed": 0, "empty": 0, "proposals_only": 0, "untouched": 0}
    for image in images:
        counts[_bucket(image)] += 1
    n_total = len(images)
    checked = counts["confirmed"] + counts["empty"]
    lines = [
        f"Of {n_total} {_plural(n_total, 'image', 'images')}, {checked} "
        f"{_plural(checked, 'was', 'were')} checked by a person: {counts['confirmed']} with "
        f"machinery, {counts['empty']} confirmed empty."
    ]
    if counts["proposals_only"] > 0:
        p = counts["proposals_only"]
        lines.append(
            f"{p} {_plural(p, 'image', 'images')} {_plural(p, 'has', 'have')} only unreviewed "
            "proposals (dashed boxes below)."
        )
    if counts["untouched"] > 0:
        u = counts["untouched"]
        lines.append(
            f"{u} {_plural(u, 'image', 'images')} {_plural(u, 'has', 'have')} not been looked at yet."
        )
    return "".join(f"<p>{line}</p>" for line in lines)


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


def _unreviewed_class_counts(boxes: list[ExportBox], class_names: list[str]) -> dict[str, int]:
    counts = dict.fromkeys(class_names, 0)
    for b in boxes:
        if b.review_state == "unreviewed" and b.class_name in counts:
            counts[b.class_name] += 1
    return counts


def _totals_table(images: list[ExportImage], class_names: list[str], has_unreviewed: bool) -> str:
    totals = dict.fromkeys(class_names, 0)
    unreviewed_totals = dict.fromkeys(class_names, 0)
    for image in images:
        for cls, n in class_counts(image.boxes, class_names).items():
            totals[cls] += n
        if has_unreviewed:
            for cls, n in _unreviewed_class_counts(image.boxes, class_names).items():
                unreviewed_totals[cls] += n
    extra_head = "<th>of which unreviewed</th>" if has_unreviewed else ""
    rows = []
    for cls, n in totals.items():
        extra_cell = f"<td>{unreviewed_totals[cls]}</td>" if has_unreviewed else ""
        rows.append(f"<tr><td>{_e(cls)}</td><td>{n}</td>{extra_cell}</tr>")
    return (
        f"<table><thead><tr><th>Class</th><th>Count</th>{extra_head}</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def _group_table(images: list[ExportImage], class_names: list[str], has_unreviewed: bool) -> str:
    per_group: dict[str, dict[str, int]] = {}
    images_per_group: dict[str, int] = {}
    unreviewed_per_group: dict[str, int] = {}
    for image in images:
        images_per_group[image.group] = images_per_group.get(image.group, 0) + 1
        counts = per_group.setdefault(image.group, dict.fromkeys(class_names, 0))
        for cls, n in class_counts(image.boxes, class_names).items():
            counts[cls] += n
        if has_unreviewed:
            unreviewed_per_group[image.group] = unreviewed_per_group.get(image.group, 0) + sum(
                1 for b in image.boxes if b.review_state == "unreviewed"
            )
    class_head = "".join(f"<th>{_e(c)}</th>" for c in class_names)
    extra_head = "<th>of which unreviewed</th>" if has_unreviewed else ""
    body = []
    for group in sorted(per_group):
        counts = per_group[group]
        cells = "".join(f"<td>{counts[c]}</td>" for c in class_names)
        total = sum(counts.values())
        extra_cell = f"<td>{unreviewed_per_group[group]}</td>" if has_unreviewed else ""
        body.append(
            f"<tr><td>{_e(group)}</td><td>{images_per_group[group]}</td>{cells}"
            f"<td>{total}</td>{extra_cell}</tr>"
        )
    return (
        "<table><thead><tr><th>Group</th><th>Images</th>"
        f"{class_head}<th>Total</th>{extra_head}</tr></thead><tbody>{''.join(body)}</tbody></table>"
    )


def _settings_text(settings: dict) -> str:
    formats = ", ".join(settings.get("formats") or [])
    unreviewed = "yes" if settings.get("include_unreviewed") else "no"
    return f"Formats: {_e(formats)}. Included unreviewed proposals: {_e(unreviewed)}."


def _card(image: ExportImage, class_names: list[str], thumbnail: bytes | None) -> str:
    counts = class_counts(image.boxes, class_names)
    unreviewed_counts = _unreviewed_class_counts(image.boxes, class_names)
    parts = []
    for cls, n in counts.items():
        if not n:
            continue
        u = unreviewed_counts[cls]
        parts.append(f"{cls} {n} ({u} unreviewed)" if u else f"{cls} {n}")
    summary = ", ".join(parts)
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
            f"<p>{left_out} more {_plural(left_out, 'image', 'images')} with machinery "
            "are not shown here; see detections.csv for all of them.</p>"
        )

    legend = ""
    if has_unreviewed:
        legend = '<p>A dashed box with "?" after the class name is an unreviewed proposal.</p>'

    parts = [
        "<!DOCTYPE html>",
        '<html><head><meta charset="utf-8">'
        f"<title>{_e(project_name)} — results export</title><style>{_STYLE}</style></head><body>",
        f"<h1>{_e(project_name)}</h1>",
        f"<p>Exported {_e(_format_export_time(export_time))}</p>",
        f"<p>{_settings_text(settings)}</p>",
        _summary_html(images),
        legend,
        "<h2>Totals</h2>",
        _totals_table(images, class_names, has_unreviewed),
        "<h2>By group</h2>",
        _group_table(images, class_names, has_unreviewed),
        "<h2>Images</h2>",
        f'<div class="cards">{"".join(cards)}</div>',
        overflow,
        "</body></html>",
    ]
    (folder / REPORT_NAME).write_text("\n".join(parts), "utf-8")
    return [REPORT_NAME]
