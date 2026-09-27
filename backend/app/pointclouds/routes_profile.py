"""Cross-section profile routes (spec 2026-09-26-point-cloud-workspace section 12 rows 9-10), C-B2.

`getCloudProfile` compresses its own body (at most 500 000 points of JSON) when it is at least
64 KiB and the client accepts gzip: route-scoped, as section 18 asks, not app-wide middleware.
"""

from __future__ import annotations

import gzip

from fastapi import APIRouter, Depends, Request, Response

from app.events_util import publish_pointclouds_changed
from app.jobs.schemas import JobOut
from app.pointclouds import profile
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

GZIP_MIN_BYTES = 64 * 1024

sub = APIRouter()


def json_maybe_gzip(request: Request, payload: bytes) -> Response:
    headers = {"Vary": "Accept-Encoding"}
    accepts = request.headers.get("accept-encoding", "").lower()
    if len(payload) >= GZIP_MIN_BYTES and "gzip" in accepts:
        headers["Content-Encoding"] = "gzip"
        payload = gzip.compress(payload, compresslevel=5)
    return Response(content=payload, media_type="application/json", headers=headers)


@sub.post(
    "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/retry", response_model=JobRef, status_code=202
)
def retry_cloud_profile(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    job = profile.retry_profile(handle, request.app.state.jobs, cloudId, cloudMeasurementId)
    publish_pointclouds_changed(request, handle, [cloudId])
    return JobRef(job=JobOut.from_row(job, handle.id))


@sub.get("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/profile", response_model=None)
def get_cloud_profile(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    return json_maybe_gzip(request, profile.read_profile_body(handle, cloudId, cloudMeasurementId))
