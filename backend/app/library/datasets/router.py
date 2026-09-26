"""`/library/datasets` (foundation F §12.3). Included by `app.library.router`."""

from fastapi import APIRouter, Depends, Request

from app.library.datasets import service
from app.library.datasets.schemas import DatasetFilter, DatasetPreview
from app.library.handle import LibraryHandle, get_library

router = APIRouter(prefix="/datasets", tags=["library"])


@router.post("/preview", response_model=DatasetPreview)
def preview_dataset(
    body: DatasetFilter, request: Request, lib: LibraryHandle = Depends(get_library)
) -> DatasetPreview:
    """COUNTs only; the builder calls it as the filter changes (F §12.2 step 1)."""
    return service.preview(request.app.state.projects, body)
