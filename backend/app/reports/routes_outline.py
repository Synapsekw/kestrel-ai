"""GET …/reports/{reportId}/outline and GET …/sections/{sectionKey}/blocks (spec §14). R2 replaces
R0's 501 stubs. Both read the saved config; `now` is read once here and is compose's only clock."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response

from app.errors import not_found
from app.projects.service import ProjectHandle, get_project
from app.reports import outline
from app.reports.models import Report
from app.reports.schemas import BlockPage, ReportConfig, ReportOutline, SectionKey

router = APIRouter(prefix="/projects/{projectId}")


def _config(handle: ProjectHandle, report_id: str) -> ReportConfig:
    with handle.session() as s:
        row = s.get(Report, report_id)
        if row is None:
            raise not_found("report", report_id)
        return ReportConfig.model_validate(row.config)


@router.get("/reports/{reportId}/outline", response_model=ReportOutline, operation_id="getReportOutline")
def get_report_outline(reportId: str, handle: ProjectHandle = Depends(get_project)) -> ReportOutline:  # noqa: N803
    return outline.build_outline(handle, reportId, _config(handle, reportId), generated_at=datetime.now(UTC))


@router.get(
    "/reports/{reportId}/sections/{sectionKey}/blocks",
    response_model=BlockPage,
    operation_id="listReportSectionBlocks",
)
def list_report_section_blocks(
    reportId: str,  # noqa: N803 - path param from the contract
    sectionKey: SectionKey,  # noqa: N803 - path param from the contract
    response: Response,
    cursor: str | None = None,
    limit: int = Query(outline.DEFAULT_BLOCKS, ge=1, le=outline.MAX_BLOCKS),
    handle: ProjectHandle = Depends(get_project),
) -> BlockPage:
    page, etag = outline.section_blocks(
        handle,
        reportId,
        _config(handle, reportId),
        str(sectionKey),
        cursor=cursor,
        limit=limit,
        generated_at=datetime.now(UTC),
    )
    response.headers["ETag"] = f'"{etag}"'
    return page
