"""`/library/training-runs` (foundation F §12.3). Included by `app.library.router`."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from app.jobs.schemas import JobOut
from app.library.handle import LibraryHandle, get_library
from app.training import (
    jobs,  # noqa: F401 - the import registers the `train` job type
    runs,
)
from app.training.schemas import TrainingRunOut, TrainingRunPage, TrainingRunWithJob, TrainRequest

router = APIRouter(prefix="/training-runs", tags=["library"])


@router.get("", response_model=TrainingRunPage)
def list_training_runs(
    lib: LibraryHandle = Depends(get_library),
    dataset_id: str | None = None,
    state: Literal["queued", "running", "succeeded", "failed", "cancelled"] | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> TrainingRunPage:
    items, next_cursor = runs.list_runs(lib, limit, cursor, dataset_id=dataset_id, state=state)
    return TrainingRunPage(items=items, next_cursor=next_cursor)


@router.post("", response_model=TrainingRunWithJob, status_code=202)
def start_training_run(
    body: TrainRequest, request: Request, lib: LibraryHandle = Depends(get_library)
) -> TrainingRunWithJob:
    """Train a library dataset; the finished weights are registered in the library (F §12.2)."""
    run_id = runs.create_run(lib, body)
    try:
        job = request.app.state.jobs.submit(lib, "train", {**body.model_dump(), "training_run_id": run_id})
    except Exception:
        runs.discard(lib, run_id)
        raise
    runs.set_job(lib, run_id, job.id)
    return TrainingRunWithJob(training_run=runs.get_run(lib, run_id), job=JobOut.from_row(job, lib.id))


@router.get("/{runId}", response_model=TrainingRunOut)
def get_training_run(runId: str, lib: LibraryHandle = Depends(get_library)) -> TrainingRunOut:  # noqa: N803
    return runs.get_run(lib, runId)
