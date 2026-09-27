"""Shared helpers for the image summary and index tests (plan I-BX)."""

from uuid import uuid4

from sqlalchemy import select

from app.db.models import Box, Image, ImageSummary, Source

GROUND_TRUTH = ("accepted", "edited")


def new_image(handle, *, width: int = 320, height: int = 240, source_id: str | None = None, **cols) -> str:
    """An image row in its own (or the given) source; no file on disk is needed for box writes."""
    with handle.session() as s:
        if source_id is None:
            src = Source(folder=f"C:/flights/{uuid4().hex}", site="A")
            s.add(src)
            s.flush()
            source_id = src.id
        image = Image(
            path=f"images/{uuid4().hex}.jpg", width=width, height=height, source_id=source_id, **cols
        )
        s.add(image)
        s.flush()
        return image.id


def add_box(handle, image_id: str, class_id: str, *, state: str = "accepted", conf=None, shape="box") -> str:
    with handle.session() as s:
        row = Box(
            image_id=image_id,
            class_id=class_id,
            x=1,
            y=1,
            w=5,
            h=5,
            shape=shape,
            confidence=conf,
            provenance_kind="person" if state == "accepted" and conf is None else "local_model",
            review_state=state,
        )
        s.add(row)
        s.flush()
        return row.id


def expected_summary(handle, image_id: str) -> tuple[int, int, float | None]:
    """The oracle: the summary recomputed in Python from the image's boxes."""
    with handle.session() as s:
        rows = s.execute(
            select(Box.review_state, Box.shape, Box.confidence).where(Box.image_id == image_id)
        ).all()
    annotations = sum(1 for st, shape, _ in rows if st in GROUND_TRUTH and shape != "point")
    pending = [c for st, _, c in rows if st == "unreviewed"]
    confs = [c for c in pending if c is not None]
    return annotations, len(pending), (max(confs) if confs else None)


def stored_summary(handle, image_id: str) -> tuple[int, int, float | None]:
    """The stored row, with an absent row read as zeros (plan I-BX Ruling 2)."""
    with handle.session() as s:
        row = s.get(ImageSummary, image_id)
        if row is None:
            return 0, 0, None
        return row.annotation_count, row.pending_count, row.max_pending_conf
