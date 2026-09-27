"""`/library/datasets` (foundation F §12.3). Included by `app.library.router`."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.jobs.schemas import JobOut
from app.library.catalogue_port import CataloguePort, get_catalogue
from app.library.datasets import (
    build,  # noqa: F401 - the import registers `dataset_build`
    export,  # noqa: F401 - the import registers the `dataset` job
    service,
)
from app.library.datasets.schemas import (
    DatasetFilter,
    DatasetItemPage,
    DatasetPreview,
    DatasetTask,
    LibraryDatasetCreate,
    LibraryDatasetOut,
    LibraryDatasetPage,
    LibraryDatasetWithJob,
)
from app.library.handle import LibraryHandle, get_library
from app.training.schemas import JobRef

router = APIRouter(prefix="/datasets", tags=["library"])


@router.get("", response_model=LibraryDatasetPage)
def list_datasets(
    lib: LibraryHandle = Depends(get_library),
    task: DatasetTask | None = None,
    origin: Literal["built", "legacy"] | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> LibraryDatasetPage:
    items, next_cursor = service.list_datasets(lib, limit, cursor, task=task, origin=origin)
    return LibraryDatasetPage(items=items, next_cursor=next_cursor)


@router.post("", response_model=LibraryDatasetWithJob, status_code=202)
def create_dataset(
    body: LibraryDatasetCreate,
    request: Request,
    lib: LibraryHandle = Depends(get_library),
    catalogue: CataloguePort = Depends(get_catalogue),
) -> LibraryDatasetWithJob:
    """Queue a `dataset_build` job; no image is copied (F §12.2 step 2)."""
    dataset_id = service.create_dataset(lib, request.app.state.projects, catalogue, body)
    # The answer is the dataset as queued (`resolving`, per the contract), read before the job can
    # run: read after, a quick build has already written `ready` and the answer races it.
    queued = service.get_dataset(lib, dataset_id)
    try:
        job = request.app.state.jobs.submit(lib, "dataset_build", {"dataset_id": dataset_id})
    except Exception:
        service.discard(lib, dataset_id)
        raise
    service.set_job(lib, dataset_id, job.id)
    return LibraryDatasetWithJob(
        dataset=queued.model_copy(update={"job_id": job.id}), job=JobOut.from_row(job, lib.id)
    )


@router.post("/preview", response_model=DatasetPreview)
def preview_dataset(
    body: DatasetFilter,
    request: Request,
    lib: LibraryHandle = Depends(get_library),
    task: DatasetTask = "detect",
) -> DatasetPreview:
    """COUNTs only; the builder calls it as the filter changes (F §12.2 step 1)."""
    return service.preview(request.app.state.projects, body, task)


@router.get("/{datasetId}", response_model=LibraryDatasetOut)
def get_dataset(datasetId: str, lib: LibraryHandle = Depends(get_library)) -> LibraryDatasetOut:  # noqa: N803
    return service.get_dataset(lib, datasetId)


@router.delete("/{datasetId}", status_code=204)
def delete_dataset(datasetId: str, lib: LibraryHandle = Depends(get_library)) -> Response:  # noqa: N803
    service.delete_dataset(lib, datasetId)
    return Response(status_code=204)


@router.post("/{datasetId}/export", response_model=JobRef, status_code=202)
def export_dataset(datasetId: str, request: Request, lib: LibraryHandle = Depends(get_library)) -> JobRef:  # noqa: N803
    """Write the YOLO export as a `dataset` job; images are hard-linked when possible (F §12.2)."""
    service.check_exportable(lib, datasetId)
    job = request.app.state.jobs.submit(lib, "dataset", {"dataset_id": datasetId})
    service.mark_export_queued(lib, datasetId, job.id)
    return JobRef(job=JobOut.from_row(job, lib.id))


@router.get("/{datasetId}/items", response_model=DatasetItemPage)
def list_dataset_items(
    datasetId: str,  # noqa: N803
    lib: LibraryHandle = Depends(get_library),
    split: Literal["train", "val"] | None = None,
    project_id: str | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> DatasetItemPage:
    items, next_cursor = service.list_items(lib, datasetId, split, limit, cursor, project_id=project_id)
    return DatasetItemPage(items=items, next_cursor=next_cursor)
