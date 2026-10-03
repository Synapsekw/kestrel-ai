"""Adding versions (spec §5, D6): validate, insert, point the model at it, queue its GLB."""

from __future__ import annotations

from pydantic import ValidationError

from app.asset_models import store
from app.asset_models.jobs_glb import GLB_JOB
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import FALLBACK_CODES, as_dicts, is_large, validate
from app.db.models import AssetModelVersion
from app.errors import AppError


def issues(report_list) -> list[dict]:
    return as_dicts(report_list)


def version_warnings(row, spec: AssetSpec) -> list[dict]:
    """A version detail's `warnings`: the warnings, plus the item problems the GLB survives
    (FALLBACK_CODES). A large spec's come from its GLB job (meta["validation"]), [] until it ran."""
    if is_large(spec):
        found = (row.meta or {}).get("validation") or {}
        return list(found.get("errors", [])) + list(found.get("warnings", []))
    report = validate(spec)
    return issues([e for e in report.errors if e.code in FALLBACK_CODES] + report.warnings)


def parse_spec(raw: dict) -> AssetSpec:
    """The request's spec, or 422 `invalid_spec` naming each problem (never echoing the input)."""
    try:
        return AssetSpec.model_validate(raw)
    except ValidationError as exc:
        parts = raw.get("parts") if isinstance(raw.get("parts"), list) else []
        errors = []
        for e in exc.errors(include_input=False, include_url=False, include_context=False):
            loc = e["loc"]
            part = parts[loc[1]] if len(loc) > 1 and loc[0] == "parts" and isinstance(loc[1], int) else None
            part_id = part.get("id") if isinstance(part, dict) and isinstance(part.get("id"), str) else None
            errors.append(
                {
                    "code": "invalid_value",
                    "part_id": part_id,
                    "message": f"{'.'.join(str(x) for x in loc)}: {e['msg']}",
                }
            )
        raise AppError("invalid_spec", "The model spec has errors.", 422, {"errors": errors}) from None


def refresh_status(model) -> None:
    model.status = "building" if model.live_run_id else ("ready" if model.current_version else "empty")


def add_version(
    handle,
    runner,
    model_id: str,
    spec: AssetSpec,
    *,
    kind: str,
    note: str | None = None,
    source_ids=(),
    run_id: str | None = None,
):
    # A large spec is validated in its GLB job, not here: the request stays schema-only (spec §5).
    if not is_large(spec):
        report = validate(spec)
        if not report.ok:
            raise AppError(
                "invalid_spec", "The model spec has errors.", 422, {"errors": issues(report.errors)}
            )
    with handle.session() as s:
        model = store.get_model(s, model_id)
        n = store.next_version_number(s, model_id)
        row = AssetModelVersion(
            model_id=model_id,
            version=n,
            spec=spec.model_dump(mode="json"),
            kind=kind,
            glb_status="pending",
            source_ids=[dict(x) for x in source_ids],
            run_id=run_id,
            note=note,
            part_count=len(spec.parts),
        )
        s.add(row)
        model.current_version = n
        refresh_status(model)
        s.flush()
        s.expunge(row)
    try:
        job = runner.submit(handle, GLB_JOB, {"model_id": model_id, "version": n})
    except Exception:
        with handle.session() as s:
            store.get_version(s, model_id, n).glb_status = "failed"
        raise
    with handle.session() as s:
        store.get_version(s, model_id, n).glb_job_id = job.id
    return row, job
