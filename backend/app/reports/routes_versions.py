"""Renders and versions (spec 2026-09-26-reports §14; plan R5). reportlab and openpyxl are never
imported here: `render_job` imports them inside its phases.

Keeps R0's `router = APIRouter(prefix="/projects/{projectId}")` line; decorator paths below are
relative to that prefix. The path parameter is `versionNumber` (contract `minimum: 1`), not `n`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from app.exports.schemas import JobRef
from app.jobs.schemas import JobOut
from app.pagination import MAX_LIMIT
from app.projects.service import ProjectHandle, get_project
from app.reports import (
    render_job,  # noqa: F401 - registers `report_render`
    versions,
)
from app.reports.schemas import (
    RenderRequest,
    ReportDocumentPage,
    ReportVersion,
    ReportVersionPage,
    ReportVersionPatch,
)

router = APIRouter(prefix="/projects/{projectId}")


@router.post(
    "/reports/{reportId}/renders", response_model=JobRef, status_code=202, operation_id="createReportRender"
)
def create_render(
    reportId: str,  # noqa: N803 - path param from the contract
    body: RenderRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    job = versions.start_render(
        handle, request.app.state.jobs, reportId, formats=list(dict.fromkeys(body.formats)), label=body.label
    )
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get(
    "/reports/{reportId}/versions", response_model=ReportVersionPage, operation_id="listReportVersions"
)
def list_report_versions(
    reportId: str,  # noqa: N803 - path param from the contract
    limit: int | None = Query(None, ge=1, le=MAX_LIMIT),
    cursor: str | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> ReportVersionPage:
    return versions.list_versions(handle, reportId, limit=limit, cursor=cursor)


@router.get(
    "/reports/{reportId}/versions/{versionNumber}",
    response_model=ReportVersion,
    operation_id="getReportVersion",
)
def get_report_version(
    reportId: str,  # noqa: N803 - path param from the contract
    versionNumber: int = Path(ge=1),  # noqa: N803 - path param from the contract
    handle: ProjectHandle = Depends(get_project),
) -> ReportVersion:
    return versions.get_numbered(handle, reportId, versionNumber)


@router.patch(
    "/reports/{reportId}/versions/{versionNumber}",
    response_model=ReportVersion,
    operation_id="patchReportVersion",
)
def patch_report_version(
    reportId: str,  # noqa: N803 - path param from the contract
    body: ReportVersionPatch,
    versionNumber: int = Path(ge=1),  # noqa: N803 - path param from the contract
    handle: ProjectHandle = Depends(get_project),
) -> ReportVersion:
    return versions.set_issued(handle, reportId, versionNumber, body.issued)


@router.delete(
    "/reports/{reportId}/versions/{versionNumber}", status_code=204, operation_id="deleteReportVersion"
)
def delete_report_version(
    reportId: str,  # noqa: N803 - path param from the contract
    versionNumber: int = Path(ge=1),  # noqa: N803 - path param from the contract
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    versions.delete_version(handle, reportId, versionNumber)
    return Response(status_code=204)


@router.get(
    "/reports/{reportId}/versions/{versionNumber}/document",
    response_model=ReportDocumentPage,
    operation_id="getReportVersionDocument",
)
def get_report_version_document(
    reportId: str,  # noqa: N803 - path param from the contract
    versionNumber: int = Path(ge=1),  # noqa: N803 - path param from the contract
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1, le=versions.DOCUMENT_MAX_LIMIT),
    handle: ProjectHandle = Depends(get_project),
) -> ReportDocumentPage:
    return versions.document_page(handle, reportId, versionNumber, cursor=cursor, limit=limit)
