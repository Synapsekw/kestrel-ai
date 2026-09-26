"""Test helpers for the models backend (plan BM): projects, images and boxes written directly,
so the tests do not depend on the project-creation API that BK and BC change in parallel."""

import inspect
from pathlib import Path

from app.db.models import Box, Image, Source
from app.projects.service import ProjectHandle

LIB = "/api/v1/library"


def make_project(app, folder: Path, name: str) -> ProjectHandle:
    """An empty project. The one place BM's tests create one: `ProjectRegistry.create` loses its
    `kind` argument in BK (foundation §6.1), and this call works on either side of that merge."""
    registry = app.state.projects
    if "kind" in inspect.signature(registry.create).parameters:
        return registry.create(name, folder, [], "detect")
    return registry.create(name, folder, [])


def add_source(handle: ProjectHandle, *, site: str = "site", captured_on=None) -> str:
    with handle.session() as s:
        row = Source(
            folder=str(handle.folder / "incoming" / site), site=site, kind="images", captured_on=captured_on
        )
        s.add(row)
        s.flush()
        return row.id


def add_image(
    handle: ProjectHandle,
    make_jpeg,
    source_id: str,
    name: str,
    *,
    site: str = "site",
    w: int = 64,
    h: int = 48,
    group_key: str = "g1",
    capture_time=None,
    alt: float | None = None,
    lat: float | None = None,
    lon: float | None = None,
    marked_empty: bool = False,
    exif: dict | None = None,
    seed: int = 0,
) -> str:
    """A real JPEG at `images/<site>/<name>` and its image row, exactly where import puts them."""
    rel = f"images/{site}/{name}"
    make_jpeg(handle.folder / rel, w, h, seed=seed, exif=exif)
    with handle.session() as s:
        row = Image(
            path=rel,
            width=w,
            height=h,
            source_id=source_id,
            group_key=group_key,
            capture_time=capture_time,
            alt=alt,
            lat=lat,
            lon=lon,
            marked_empty=marked_empty,
        )
        s.add(row)
        s.flush()
        return row.id


def add_box(
    handle: ProjectHandle,
    image_id: str,
    type_id: str,
    *,
    x: float = 4.0,
    y: float = 4.0,
    w: float = 20.0,
    h: float = 10.0,
    angle: float = 0.0,
    review_state: str = "accepted",
    provenance_kind: str = "person",
) -> str:
    with handle.session() as s:
        row = Box(
            image_id=image_id,
            class_id=type_id,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            review_state=review_state,
            provenance_kind=provenance_kind,
        )
        s.add(row)
        s.flush()
        return row.id
