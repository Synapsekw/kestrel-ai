"""Logo import and read (spec 2026-09-26-reports sections 6.1, 14; coordinator ruling: the preview
builds the cover logo URL from `CoverLogo.asset_id`): 501 until unit R1 rewrites this module."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}")

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/report-assets", "createReportAsset"),
    ("GET", "/report-assets/{assetId}", "getReportAsset"),
]

add_stubs(router, STUBS)
