"""`asset_model_glb` (spec §6.4): build the GLB of one stored version, atomically."""

from __future__ import annotations

import os

from app.asset_models import store
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"


def _mark_failed(ctx) -> None:
    with ctx.project.session() as s:
        store.get_version(s, ctx.params["model_id"], int(ctx.params["version"])).glb_status = "failed"
    ctx.publish("asset_models.changed", {"asset_model_ids": [ctx.params["model_id"]]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx)


@register_job_type(GLB_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    out = store.version_glb_path(ctx.project, mid, n)
    tmp = out.with_name(out.name + ".tmp")
    try:
        with ctx.project.session() as s:
            spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
        glb, meta = build_glb(spec)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(glb)
        os.replace(tmp, out)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        _mark_failed(ctx)
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    with ctx.project.session() as s:
        v = store.get_version(s, mid, n)
        v.glb_status, v.meta = "ready", meta
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
