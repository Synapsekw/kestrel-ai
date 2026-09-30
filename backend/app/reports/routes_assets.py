"""Logo import and read (spec 2026-09-26-reports sections 6.1, 14; ledger Ruling P5 adds
`getReportAsset`, the preview's cover logo source via `CoverLogo.asset_id`).

Keeps R0's `router = APIRouter(prefix="/projects/{projectId}")` line; decorator paths below are
relative to that prefix.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.errors import not_found
from app.projects.service import ProjectHandle, get_project
from app.reports import assets
from app.reports.schemas import ReportAsset, ReportAssetCreate

router = APIRouter(prefix="/projects/{projectId}")

CACHE_CONTROL = "private, max-age=31536000, immutable"


@router.post("/report-assets", response_model=ReportAsset, status_code=201)
def create_report_asset(body: ReportAssetCreate, handle: ProjectHandle = Depends(get_project)) -> ReportAsset:
    return assets.import_logo(handle, body.path)


@router.get("/report-assets/{assetId}", response_class=FileResponse)
def get_report_asset(assetId: str, handle: ProjectHandle = Depends(get_project)) -> FileResponse:  # noqa: N803
    path = assets.asset_path(handle, assetId)
    if path is None:
        raise not_found("report asset", assetId)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": CACHE_CONTROL})
