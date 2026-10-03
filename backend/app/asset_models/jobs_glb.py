"""`asset_model_glb` (spec §6.4): build the GLB of one stored version, atomically.

A spec of more than 200 items and environment features is validated here, not in the request
(spec 2026-10-03-plant-model-generator §5): its report goes to the version's meta["validation"],
and blocking errors fail the version without building it.
"""

from __future__ import annotations

import os

from app.asset_models import store
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import is_large, validate, validation_meta
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"


class _SpecErrors(Exception):
    """The large spec has blocking errors (its report is already in hand)."""


def _mark_failed(ctx, meta: dict | None = None) -> None:
    with ctx.project.session() as s:
        v = store.get_version(s, ctx.params["model_id"], int(ctx.params["version"]))
        v.glb_status = "failed"
        if meta is not None:
            v.meta = meta
    ctx.publish("asset_models.changed", {"asset_model_ids": [ctx.params["model_id"]]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx)


@register_job_type(GLB_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    out = store.version_glb_path(ctx.project, mid, n)
    tmp = out.with_name(out.name + ".tmp")
    checked = None
    try:
        with ctx.project.session() as s:
            spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
        if is_large(spec):
            ctx.progress(0.02, f"Checking the model spec of version {n}")
            report = validate(spec)
            checked = validation_meta(report)
            if not report.ok:
                raise _SpecErrors()
        glb, meta = build_glb(spec)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(glb)
        os.replace(tmp, out)
    except _SpecErrors:
        _mark_failed(ctx, meta={"validation": checked})
        raise JobFailure("The model spec has errors; open the version to see them.") from None
    except Exception as e:
        tmp.unlink(missing_ok=True)
        _mark_failed(ctx, meta={"validation": checked} if checked else None)
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status, v.meta = "ready", ({**meta, "validation": checked} if checked else meta)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
