"""Training runs (foundation F §12.1-§12.3): one row per `train` job, the history the Training
screen lists. The row's state is written by the job and read through the job, so a run a restart
interrupted reads `failed` rather than `running` for ever (plan BM decision 5). Every refusal is
here, before a job is queued."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import yaml
from sqlalchemy import and_, case, delete, select

from app.db.models import Job
from app.errors import AppError, not_found
from app.library import service as library
from app.library.datasets.service import (
    LIVE,
    SEGMENT_NOT_SUPPORTED,
    TERMINAL,
    effective_export_state,
    effective_state,
    job_states,
)
from app.library.db import LibraryDataset, TrainingRun
from app.library.handle import LibraryHandle
from app.pagination import newest_first_page
from app.training.schemas import ModelMetrics, TrainingRunOut, TrainRequest


def yaml_class_names(data_yaml: Path) -> list[str]:
    """`names` from a YOLO data.yaml, in class-index order (a mapping or a plain list)."""
    names = (yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}).get("names") or {}
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=lambda k: int(k))]
    return [str(n) for n in names]


def data_yaml_of(lib: LibraryHandle, dataset: LibraryDataset) -> Path:
    if dataset.origin == "legacy":
        return Path(dataset.legacy_path or "") / "data.yaml"
    return lib.folder / (dataset.export_path or "") / "data.yaml"


def check_data_yaml(path: Path, dataset: LibraryDataset) -> Path:
    """The dataset's class snapshot is what the model is registered with, so the file the trainer
    reads must agree with it: a drifted data.yaml would label every class wrongly. A missing file
    is 409 `not_ready`; one that disagrees is 409 `conflict` (amendment A3)."""
    if not path.is_file():
        raise AppError("not_ready", f"Dataset {dataset.name} has no data.yaml at {path.parent}.", 409)
    snapshot = [str(c.get("name")) for c in dataset.classes or []]
    try:
        in_file = yaml_class_names(path)
    except Exception as e:
        raise AppError("conflict", f"Dataset {dataset.name} has an unreadable {path}: {e}", 409) from None
    if snapshot != in_file:
        raise AppError(
            "conflict",
            f"Dataset {dataset.name} lists classes {snapshot} but {path} has {in_file}.",
            409,
        )
    return path


def create_run(lib: LibraryHandle, body: TrainRequest) -> str:
    """Refuse what cannot train (404, 409, 422 - never after a job is queued), then write the row."""
    base = library.require_ready(lib, body.base_model_id)  # 404 unknown, 409 model_unavailable
    with lib.session() as s:
        dataset = s.get(LibraryDataset, body.dataset_id)
        if dataset is None:
            raise not_found("dataset", body.dataset_id)
        jobs = job_states(s, [dataset.job_id, dataset.export_job_id])
        state, export_state = effective_state(dataset, jobs), effective_export_state(lib, dataset, jobs)
        s.expunge(dataset)
    if state != "ready":
        raise AppError("not_ready", f"Dataset {dataset.name} is {state}; train it once it is ready.", 409)
    if dataset.task == "segment":
        raise AppError("task_not_supported", SEGMENT_NOT_SUPPORTED, 422)
    if base.task != dataset.task:
        raise AppError(
            "task_mismatch",
            f"{base.name} is a {base.task} model and {dataset.name} is a {dataset.task} dataset. "
            f"Start from a {dataset.task} model.",
            422,
            {"base_task": base.task, "dataset_task": dataset.task},
        )
    if export_state == "building":
        raise AppError(
            "job_running", f"Dataset {dataset.name} is being exported; start when it has finished.", 409
        )
    if dataset.origin == "legacy":
        check_data_yaml(data_yaml_of(lib, dataset), dataset)
    with lib.session() as s:
        row = TrainingRun(
            name=body.name,
            dataset_id=dataset.id,
            base_model_id=base.id,
            params=body.model_dump(),
            state="queued",
        )
        s.add(row)
        s.flush()
        return row.id


def _update(lib: LibraryHandle, run_id: str, **fields) -> None:
    with lib.session() as s:
        row = s.get(TrainingRun, run_id)
        if row is not None:
            for k, v in fields.items():
                setattr(row, k, v)


def set_job(lib: LibraryHandle, run_id: str, job_id: str) -> None:
    _update(lib, run_id, job_id=job_id)


def discard(lib: LibraryHandle, run_id: str) -> None:
    """Drop a row whose job could not be queued, so no run stays `queued` for ever."""
    with lib.session() as s:
        s.execute(delete(TrainingRun).where(TrainingRun.id == run_id))


def mark_running(lib: LibraryHandle, run_id: str) -> None:
    _update(lib, run_id, state="running")


def finish(
    lib: LibraryHandle, run_id: str, state: str, *, model_id: str | None = None, metrics: dict | None = None
) -> None:
    _update(lib, run_id, state=state, model_id=model_id, metrics=metrics, finished_at=datetime.now(UTC))


def state_of(row: TrainingRun, jobs: dict[str, str]) -> str:
    """The row's state, read through its job while the row says the run is live (decision 5)."""
    if row.state in LIVE and row.job_id:
        job = jobs.get(row.job_id)
        if job in TERMINAL:
            return job
        if job is None:
            return "failed"
    return row.state


def _state_sql():
    """`state_of` as SQL over `training_run` outer-joined to `job`, for the list's `state` filter."""
    return case(
        (
            and_(TrainingRun.state.in_(LIVE), TrainingRun.job_id.is_not(None)),
            case(
                (Job.state.in_(TERMINAL), Job.state),
                (Job.id.is_(None), "failed"),
                else_=TrainingRun.state,
            ),
        ),
        else_=TrainingRun.state,
    )


def _out(row: TrainingRun, jobs: dict[str, str]) -> TrainingRunOut:
    return TrainingRunOut(
        id=row.id,
        name=row.name,
        dataset_id=row.dataset_id,
        base_model_id=row.base_model_id,
        params=dict(row.params or {}),
        job_id=row.job_id,
        state=state_of(row, jobs),
        model_id=row.model_id,
        metrics=ModelMetrics(**row.metrics) if row.metrics else None,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


def get_run(lib: LibraryHandle, run_id: str) -> TrainingRunOut:
    with lib.session() as s:
        row = s.get(TrainingRun, run_id)
        if row is None:
            raise not_found("training run", run_id)
        return _out(row, job_states(s, [row.job_id]))


def list_runs(
    lib: LibraryHandle,
    limit: int | None,
    cursor: str | None,
    dataset_id: str | None = None,
    state: str | None = None,
) -> tuple[list[TrainingRunOut], str | None]:
    """A keyset page, newest first; `state` filters on the state the run reads (amendment A6)."""
    q = select(TrainingRun)
    if dataset_id:
        q = q.where(TrainingRun.dataset_id == dataset_id)
    if state:
        q = q.outerjoin(Job, Job.id == TrainingRun.job_id).where(_state_sql() == state)
    with lib.session() as s:
        rows, next_cursor = newest_first_page(s, q, TrainingRun.created_at, TrainingRun.id, limit, cursor)
        jobs = job_states(s, [r.job_id for r in rows])
        return [_out(r, jobs) for r in rows], next_cursor
