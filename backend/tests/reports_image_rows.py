"""Rows for the R9-I tests (reports image figures, photos, comments): an image finding over a real
JPEG, its photos through F's own `attachments.add`, and a comment thread with fixed times."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import update

from app.db.models import Box, Finding, FindingAttachment, FindingComment, Image, Source
from app.findings import attachments, service
from app.findings.anchors import AnchorIn

T0 = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
GENERATED_AT = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


def image_finding(
    handle,
    type_id: str,
    make_jpeg,
    *,
    name: str = "a.jpg",
    size: tuple[int, int] = (1600, 1200),
    shape: str = "box",
    xywh: tuple[float, float, float, float] = (700.0, 500.0, 200.0, 150.0),
    angle: float = 0.0,
    points: list[list[float]] | None = None,
) -> tuple[Finding, str, str]:
    """A ground-truth box of `shape` on a real `size` JPEG, adopted as a finding; returns
    (finding, image_id, box_id). A polygon's `xywh` is its envelope; a point has w = h = 0."""
    make_jpeg(handle.folder / "images" / name, *size)
    with handle.session() as s:
        src = Source(folder="C:/flights/a", site="A")
        s.add(src)
        s.flush()
        image = Image(path=f"images/{name}", width=size[0], height=size[1], source_id=src.id)
        s.add(image)
        s.flush()
        x, y, w, h = xywh
        box = Box(
            image_id=image.id,
            class_id=type_id,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            shape=shape,
            points=points,
            provenance_kind="person",
            review_state="accepted",
        )
        s.add(box)
        s.flush()
        image_id, box_id = image.id, box.id
    f = service.create_finding(
        handle, type_id=type_id, anchor=AnchorIn(kind="image", image_id=image_id, annotation_id=box_id)
    )
    return f, image_id, box_id


def add_photos(handle, finding_id: str, folder: Path, make_jpeg, n: int, *, size=(640, 480)) -> list[str]:
    """`n` photos through F's own copy path, with created_at T0 + i s so their order is fixed."""
    ids = []
    for i in range(n):
        src = make_jpeg(folder / f"photo{i}.jpg", *size, seed=i)
        ids.append(attachments.add(handle, finding_id, str(src)).id)
    with handle.session() as s:
        for i, aid in enumerate(ids):
            s.execute(
                update(FindingAttachment)
                .where(FindingAttachment.id == aid)
                .values(created_at=T0 + timedelta(seconds=i))
            )
    return ids


def add_comments(handle, finding_id: str, n: int, *, author: str = "Dana") -> None:
    """`n` comments "c0".."c<n-1>", created T0 + i minutes."""
    with handle.session() as s:
        for i in range(n):
            s.add(
                FindingComment(
                    finding_id=finding_id, author=author, text=f"c{i}", created_at=T0 + timedelta(minutes=i)
                )
            )


def make_ctx(handle, **finding_pages_options):
    """A ComposeContext over R2's row-test config (all 8 sections present, only `finding_pages`
    enabled), with `finding_pages` options overridden. Alignment ruling: built through R2's
    `tests/reports_rows.config`, no `key_for` (so keys are the real R3 keys), never
    `BUILTIN_TEMPLATES`."""
    from reports_rows import config

    from app.reports.context import ComposeContext

    cfg = config(sections=("finding_pages",), options={"finding_pages": finding_pages_options})
    return ComposeContext(
        handle=handle, config=cfg, report_id="r-test", baseline=None, generated_at=GENERATED_AT
    )


def row_of(handle, finding_id: str, ctx=None):
    """The FindingRow R2's iterator yields for `finding_id` (the hooks' `finding` argument). `ctx`
    resolves the type name/colour (alignment ruling); defaults to `make_ctx(handle)` so
    `row.type_name`/`row.type_colour` are always the real ones, never the ctx-less fallback."""
    from app.reports.context import FindingRow

    with handle.session() as s:
        f = s.get(Finding, finding_id)
        return FindingRow.from_finding(f, ctx or make_ctx(handle))
