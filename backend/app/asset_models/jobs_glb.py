"""`asset_model_glb` (spec 2026-10-02 §6.4, widened by 2026-10-03-plant-model-generator §7): build one
stored version's GLB, register CSV and meta atomically.

A plant spec (items or environment) is validated here, not in the request (§5): blocking errors fail
the version without building it, the rest go to meta["validation"], and the assembler builds it and
feeds the `asset_item` index. An M1 spec goes through `build_glb` and gets a header-only CSV; it is
validated in the job only when large, which an M1 spec never is.
"""

from __future__ import annotations

import json
import os

from sqlalchemy import select

from app.asset_models import plant_frame, store
from app.asset_models.assemble import AssembleError, assemble, index_items, site_label, write_csv
from app.asset_models.build import build_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import FALLBACK_CODES, is_large, validate, validation_meta
from app.db.models import Drawing
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

GLB_JOB = "asset_model_glb"
ID_CHUNK = 500


class _SpecErrors(Exception):
    """The spec has blocking errors (its report is already in hand)."""


def _mark_failed(ctx, meta: dict | None = None) -> None:
    """Fail the version; `meta` keys are merged into its existing meta."""
    with ctx.project.session() as s:
        v = store.get_version(s, ctx.params["model_id"], int(ctx.params["version"]))
        v.glb_status = "failed"
        if meta is not None:
            v.meta = {**(v.meta or {}), **meta}
    ctx.publish("asset_models.changed", {"asset_model_ids": [ctx.params["model_id"]]})


def _cancelled_before_start(ctx) -> None:
    _mark_failed(ctx)


def _cleanup(paths) -> None:
    for p in paths:
        p.unlink(missing_ok=True)


def issue_item_id(issue) -> str | None:
    """The item a validation issue is about (F0 reuses `part_id` for item ids)."""
    return getattr(issue, "item_id", None) or getattr(issue, "part_id", None)


def invalid_items(report, spec: AssetSpec) -> dict[str, str]:
    """Item id -> first message, for the item errors the GLB survives (built as `other`)."""
    ids = {i.id for i in spec.items}
    out: dict[str, str] = {}
    for issue in report.errors:
        item_id = issue_item_id(issue)
        if issue.code in FALLBACK_CODES and item_id in ids:
            out.setdefault(item_id, issue.message)
    return out


def _sheet_names(s, spec: AssetSpec) -> dict[str, str]:
    ids = sorted({i.source.id for i in spec.items if i.source.kind == "drawing" and i.source.id})
    out: dict[str, str] = {}
    for k in range(0, len(ids), ID_CHUNK):
        rows = s.execute(select(Drawing.id, Drawing.name).where(Drawing.id.in_(ids[k : k + ID_CHUNK]))).all()
        out.update({r[0]: r[1] for r in rows})
    return out


@register_job_type(GLB_JOB, on_cancelled_before_start=_cancelled_before_start)
def run_glb(ctx) -> dict:
    mid, n = ctx.params["model_id"], int(ctx.params["version"])
    ctx.progress(0, f"Building the 3D model for version {n}")
    paths = [
        store.version_glb_path(ctx.project, mid, n),
        store.version_csv_path(ctx.project, mid, n),
        store.version_meta_path(ctx.project, mid, n),
    ]
    tmps = [p.with_name(p.name + ".tmp") for p in paths]
    checked = None
    try:
        with ctx.project.session() as s:
            spec = AssetSpec.model_validate(store.get_version(s, mid, n).spec)
            names = _sheet_names(s, spec)
        plant = bool(spec.items or spec.environment)
        report = None
        if plant or is_large(spec):
            ctx.progress(0.02, f"Checking the model spec of version {n}")
            report = validate(spec)
            checked = validation_meta(report)
            if report.blocking:
                raise _SpecErrors()
        if plant:

            def progress(fraction: float) -> None:
                ctx.check_cancelled()
                ctx.progress(0.05 + 0.85 * fraction, f"Building version {n}: items")

            a = assemble(spec, progress=progress, sheet_names=names, invalid=invalid_items(report, spec))
            glb, meta, rows = a.glb, a.meta, a.rows
        else:
            glb, meta = build_glb(spec)
            rows = []
        if checked is not None:
            meta = {**meta, "validation": checked}
        paths[0].parent.mkdir(parents=True, exist_ok=True)
        tmps[0].write_bytes(glb)
        write_csv(rows, tmps[1], site_label=site_label(spec))
        tmps[2].write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        for tmp, path in zip(tmps, paths, strict=True):
            os.replace(tmp, path)
        with ctx.project.session() as s:
            index_items(s, mid, n, rows)
            v = store.get_version(s, mid, n)
            v.glb_status, v.meta = "ready", meta
            if spec.site is not None:
                plant_frame.fill_frame(s, mid, spec, meta)
    except _SpecErrors:
        _mark_failed(ctx, {"validation": checked})
        raise JobFailure("The model spec has errors; open the version to see them.") from None
    except JobCancelled:
        _cleanup(tmps)
        _mark_failed(ctx, {"validation": checked} if checked else None)
        raise
    except AssembleError as e:
        _cleanup(tmps)
        _mark_failed(ctx, {"validation": checked} if checked else None)
        raise JobFailure(f"The 3D model could not be built: {e}") from None
    except Exception as e:
        _cleanup(tmps)
        _mark_failed(ctx, {"validation": checked} if checked else None)
        raise JobFailure(f"The 3D model could not be built: {type(e).__name__}") from None
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    ctx.progress(1, f"Built version {n}: {meta['triangles']:,} triangles")
    return {"model_id": mid, "version": n}
