"""The volume plan snapshot (spec §9.1 `volume_plan{measurement_id}`): the volume export's plan
image, reused unchanged (volumes/jobs_export `_load` -> `_clutter` -> `_plan` ->
volumes/plan_image.render_plan_image), letterboxed on white into 1200 x 900 so every snapshot has a
known size. A stale or not-ready measurement is a placeholder: "stale, recalculate" (spec §16).

`source_version` reads the measurement through `app.volumes.service.get_measurement` (controller
amendment A12): that call runs `service._refresh`, which may flip a `ready` row to `stale` when its
inputs' fingerprint no longer matches (an input changed without anyone writing the stored `status`
column). `render` reaches the same refreshed state through `jobs_export._load`, which calls the same
`get_measurement`. Reading a raw, un-refreshed row here would let the key say "ready" while the
render a moment later raises the stale placeholder."""

from __future__ import annotations

import io
from types import SimpleNamespace

from PIL import Image as PILImage

from app.errors import AppError
from app.reports.snapshots import DEFAULT_OUT, MISSING, SnapshotUnavailable
from app.reports.snapshots.draw import WHITE

OUT = DEFAULT_OUT
STALE = "This volume is out of date: recalculate it before reporting"
DELETED = "The volume measurement was deleted"


def source_version(handle, spec) -> str:
    """The measurement's `results.computed_at` (spec §9.1), from the same refreshed read `render`
    uses (A12)."""
    from app.volumes import service

    try:
        out, _ = service.get_measurement(handle, spec.measurement_id)
    except AppError:
        return MISSING + DELETED
    if out.status != "ready" or out.results is None:
        return MISSING + STALE
    return out.results.computed_at.isoformat()


def fit_on_white(img: PILImage.Image, size) -> PILImage.Image:
    w, h = int(size[0]), int(size[1])
    scale = min(w / img.width, h / img.height)
    fitted = img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))), PILImage.LANCZOS
    )
    out = PILImage.new("RGB", (w, h), WHITE)
    out.paste(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    return out


def render(handle, spec) -> PILImage.Image:
    from app.jobs.cancellation import JobFailure
    from app.volumes import jobs_export

    ctx = SimpleNamespace(project=handle)  # the three helpers only read ctx.project
    try:
        item = jobs_export._load(ctx, [spec.measurement_id])[0]
    except JobFailure:
        raise SnapshotUnavailable(STALE) from None
    except AppError:
        raise SnapshotUnavailable(DELETED) from None
    item.clutter_rings = jobs_export._clutter(ctx, item)
    png = jobs_export._plan(ctx, item)
    with PILImage.open(io.BytesIO(png)) as im:
        plan = im.convert("RGB")
    return fit_on_white(plan, OUT)
