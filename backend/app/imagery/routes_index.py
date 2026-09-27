"""The browser's columnar index and the image-summary repair job (image inspection spec §7.1).

I-C0 routes both operations as 501 stubs; unit I-BX replaces them, deleting each tuple from STUBS
and its EXPECTED_STUBS entry.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from app.imagery import index as image_index
from app.imagery import jobs_summary
from app.imagery.filters import SEVERITY_PATTERN, SORT_NAMES, STATUS_PATTERN, ImageFilters, parse_csv
from app.imagery.index_schemas import ImageIndexOut
from app.imagery.jobs_summary import run_summary_rebuild  # noqa: F401 - registers `summary_rebuild`
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

IndexSort = Literal[SORT_NAMES]  # the tuple is the contract's sort enum


@router.post("/image-summary/rebuild", response_model=JobRef, status_code=202)
def rebuild_image_summary(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = jobs_summary.submit_rebuild(handle, request.app.state.jobs)
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get(
    "/images/index",
    response_model=ImageIndexOut,
    response_model_exclude_unset=True,
    operation_id="getImageIndex",
)
def get_image_index(
    handle: ProjectHandle = Depends(get_project),
    source_id: str | None = None,
    # I-C0's seven shared component parameters (ruling 6), then search/sort/order/fields.
    has_findings: bool | None = None,
    severity: str | None = Query(None, pattern=SEVERITY_PATTERN, description="csv of levels 1-9"),
    finding_status: str | None = Query(None, pattern=STATUS_PATTERN, description="csv of finding statuses"),
    type_ids: str | None = Query(None, min_length=1, description="csv of catalogue type ids"),
    has_suggestions: bool | None = None,
    reviewed: bool | None = None,
    unlabeled: bool | None = None,
    search: str | None = None,
    sort: IndexSort = "path",
    order: Literal["asc", "desc"] = "asc",
    fields: Literal["geo"] | None = None,
) -> ImageIndexOut:
    f = ImageFilters(
        source_id=source_id,
        has_findings=has_findings,
        severity=parse_csv(severity),
        finding_status=parse_csv(finding_status),
        type_ids=parse_csv(type_ids),
        has_suggestions=has_suggestions,
        reviewed=reviewed,
        unlabeled=unlabeled,
        search=search,
    )
    return ImageIndexOut(**image_index.build_index(handle, f, sort=sort, order=order, geo=fields == "geo"))
