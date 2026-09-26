"""Adopting a project's old models into the app-wide library (spec 2026-09-23 section 6).

Before the library, each project kept its models in its own `model` table and `models/` folder.
When a project with such rows is opened, a `library_adopt` job copies each model's weights,
artifacts and exports into the library (or reuses the library model with the same sha256), records
the old id -> library id pair in `model_adoption`, and rewrites the project's references to library
ids with one set-based UPDATE per table.

A model is attempted once: its outcome (`adopted`, `missing`, `failed`) is recorded, and only models
with no record are pending. "Retry" forgets the `missing` and `failed` records so the next job tries
them again. Nothing in the old `model` table or the project's `models/` folder is changed or deleted.
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import delete, func, select, update

from app.db.models import Box, Dataset, Job, MapRun, Model, ModelAdoption, Project, QueryRun
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.library import service
from app.library.handle import LIBRARY_UNAVAILABLE

ADOPT_JOB = "library_adopt"
BUSY = ("queued", "running")
NOT_ADOPTED = ("missing", "failed")
# Every column that may hold a project model id; each is rewritten by one set-based UPDATE.
REFERENCES = (
    (Project, Project.preannotation_model_id),
    (QueryRun, QueryRun.model_id),
    (MapRun, MapRun.model_id),
    (Box, Box.model_id),
)

log = logging.getLogger(__name__)


class MissingWeights(Exception):
    """The old model's weights file is not in the project folder any more."""


def pending_adoptions(handle) -> list[Model]:
    """Old models with no adoption record yet, oldest first. The `model` table is small per project."""
    recorded = select(ModelAdoption.old_model_id)
    with handle.session() as s:
        rows = list(
            s.execute(
                select(Model).where(Model.id.not_in(recorded)).order_by(Model.created_at, Model.id)
            ).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def active_job_id(handle) -> str | None:
    """The adoption job that is queued or running in this project, if any."""
    with handle.session() as s:
        return s.execute(
            select(Job.id)
            .where(Job.type == ADOPT_JOB, Job.state.in_(BUSY))
            .order_by(Job.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()


def adoption_status(handle) -> dict:
    """AdoptionStatus: counts of pending and adopted models, the ones that could not be adopted."""
    with handle.session() as s:
        adopted = s.execute(
            select(func.count()).select_from(ModelAdoption).where(ModelAdoption.status == "adopted")
        ).scalar_one()
        missing = [
            {"old_model_id": a.old_model_id, "name": name or a.old_model_id, "error": a.error or ""}
            for a, name in s.execute(
                select(ModelAdoption, Model.name)
                .outerjoin(Model, Model.id == ModelAdoption.old_model_id)
                .where(ModelAdoption.status.in_(NOT_ADOPTED))
                .order_by(Model.created_at, ModelAdoption.old_model_id)
            )
        ]
    return {
        "pending": len(pending_adoptions(handle)),
        "adopted": int(adopted),
        "missing": missing,
        "job_id": active_job_id(handle),
    }


def submit_if_pending(handle, runner):
    """On open: queue the adoption job for a project that still has unadopted models.

    Nothing happens without a library, with nothing pending, or while an adoption job is
    already queued or running. Returns the job, or None.
    """
    if runner is None or getattr(runner, "library", None) is None:
        return None
    if not pending_adoptions(handle) or active_job_id(handle) is not None:
        return None
    return runner.submit(handle, ADOPT_JOB, {})


def retry(handle, runner):
    """Forget the missing and failed records and queue the job again; 409 while one is queued or running."""
    if active_job_id(handle) is not None:
        raise AppError("conflict", "The project's models are already being moved into the library.", 409)
    with handle.session() as s:
        s.execute(delete(ModelAdoption).where(ModelAdoption.status.in_(NOT_ADOPTED)))
    return runner.submit(handle, ADOPT_JOB, {})


def _record(handle, old_id: str, status: str, library_id: str | None = None, error: str | None = None):
    with handle.session() as s:
        row = s.get(ModelAdoption, old_id)
        if row is None:
            row = ModelAdoption(old_model_id=old_id)
            s.add(row)
        row.status, row.library_model_id, row.error = status, library_id, error


def _existing_files(handle, files: dict | None) -> dict[str, Path]:
    """`{key: path}` for the recorded files that are still in the project folder."""
    out: dict[str, Path] = {}
    for key, rel in (files or {}).items():
        if rel and (handle.folder / rel).is_file():
            out[key] = handle.folder / rel
    return out


def _adopt_one(lib, handle, row: Model, project: dict, datasets: dict[str, str]) -> str:
    """The library id for one old model: an existing library model with the same weights, or a new one."""
    src = handle.folder / row.weights_path
    if not src.is_file():
        raise MissingWeights(f"weights file not found: {row.weights_path}")
    digest = service.sha256_file(src)
    existing = service.find_by_sha(lib, digest)
    if existing is not None:
        return existing.id
    task, names = "detect", list(row.class_names or [])
    if not names:
        task, names = service.read_checkpoint(src)
    try:
        model = service.add_model(
            lib,
            source_weights=src,
            name=row.name,
            origin="trained" if row.kind == "trained" else "imported",
            task=task,
            class_names=names,
            class_aliases=row.class_aliases or {},
            metrics=row.metrics,
            hyperparameters=row.hyperparameters or {},
            artifacts=_existing_files(handle, row.artifacts),
            exports=_existing_files(handle, row.exports),
            provenance={
                **project,
                "dataset_id": row.dataset_id,
                "dataset_name": datasets.get(row.dataset_id) if row.dataset_id else None,
                "run_id": row.run_id,
                "base_weights": row.base_weights,
                "adopted_from_model_id": row.id,
            },
            sha256=digest,
        )
    except AppError as e:
        if e.code == "already_exists":  # another project's adoption added the same file meanwhile
            return e.details["model_id"]
        raise
    return model.id


def rewrite_ids(handle) -> None:
    """Point every reference to an adopted old id at its library id, in one transaction.

    Set-based: one UPDATE per table per adopted model, never a row load. Ids already rewritten
    match nothing, so this is safe to run again.
    """
    with handle.session() as s:
        pairs = s.execute(
            select(ModelAdoption.old_model_id, ModelAdoption.library_model_id).where(
                ModelAdoption.status == "adopted", ModelAdoption.library_model_id.is_not(None)
            )
        ).all()
        for old, new in pairs:
            for table, column in REFERENCES:
                s.execute(
                    update(table.__table__).where(column == old).values({column.key: new}),
                )


@register_job_type(ADOPT_JOB)
def adopt_project_models(ctx) -> dict:
    """Adopt each pending old model, record the outcome, then rewrite the project's references."""
    lib = getattr(ctx.runner, "library", None)
    if lib is None:
        raise JobFailure(LIBRARY_UNAVAILABLE)
    handle = ctx.project
    rows = pending_adoptions(handle)
    with handle.session() as s:
        p = handle.row(s)
        project = {"project_id": p.id, "project_name": p.name, "project_folder": str(handle.folder)}
        datasets = dict(s.execute(select(Dataset.id, Dataset.name)).all())
    counts = {"adopted": 0, "missing": 0, "failed": 0}
    for i, row in enumerate(rows):
        ctx.check_cancelled()
        ctx.progress(i / max(len(rows), 1), f"Adopting {row.name}")
        try:
            library_id = _adopt_one(lib, handle, row, project, datasets)
        except JobCancelled:
            raise
        except MissingWeights as e:
            ctx.log.warning("model %s (%s): %s", row.name, row.id, e)
            _record(handle, row.id, "missing", error=str(e))
            counts["missing"] += 1
            continue
        except Exception as e:
            message = e.message if isinstance(e, AppError) else str(e) or type(e).__name__
            ctx.log.exception("model %s (%s) could not be adopted", row.name, row.id)
            _record(handle, row.id, "failed", error=message)
            counts["failed"] += 1
            continue
        _record(handle, row.id, "adopted", library_id)
        counts["adopted"] += 1
        ctx.log.info("adopted model %s (%s) as library model %s", row.name, row.id, library_id)
    ctx.progress(1, "Updating the project's references")
    rewrite_ids(handle)
    ctx.progress(1, "The project's models are in the library")
    return counts
