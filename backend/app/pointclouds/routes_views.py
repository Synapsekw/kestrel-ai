"""Report-view routes (spec 2026-09-26-point-cloud-workspace section 11.4; reports spec 9.4).

The `/findings/{findingId}/view3d` paths are C's, mounted through the pointclouds router (prefix
`/projects/{projectId}`), beside F's findings router, which is not touched. The PUTs read the
multipart form themselves: a browser `FormData` sends `meta` as a JSON Blob (a file part), which a
`Form()` string parameter would refuse. The subject is resolved before the body is read.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError
from app.events_util import publish_pointclouds_changed
from app.pointclouds import views
from app.pointclouds.schemas import CloudViewList, CloudViewOut
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()

IMAGE_HEADERS = {"Cache-Control": "private, no-cache"}


async def _parts(request: Request) -> tuple[bytes, str | bytes]:
    """The `image` bytes (at most MAX_BYTES + 1 read) and the raw `meta` (at most 64 KiB + 1)."""
    try:
        form = await request.form(max_files=2, max_fields=2)
    except StarletteHTTPException as e:
        # too many parts, an oversize text part, or a missing boundary: starlette answers its own
        # 400 before FastAPI's validation layer sees the request.
        raise AppError("validation_error", str(e.detail), 422) from e
    try:
        image, meta = form.get("image"), form.get("meta")
        if not isinstance(image, UploadFile):
            raise AppError("validation_error", "the upload needs an `image` file part", 422)
        if meta is None:
            raise AppError("validation_error", "the upload needs a `meta` part", 422)
        data = await image.read(views.MAX_BYTES + 1)
        raw = await meta.read(views.MAX_META_BYTES + 1) if isinstance(meta, UploadFile) else meta
        return data, raw
    finally:
        await form.close()


async def _store(request: Request, handle: ProjectHandle, subject: views.Subject) -> CloudViewOut:
    data, raw = await _parts(request)
    meta = views.parse_meta(raw, subject.kind)
    out = await run_in_threadpool(views.store, handle, subject, data, meta)
    publish_pointclouds_changed(request, handle, [subject.cloud_id])
    return out


def _image(data: bytes, media_type: str, sha256: str) -> Response:
    return Response(content=data, media_type=media_type, headers={"ETag": f'"{sha256}"', **IMAGE_HEADERS})


@sub.put("/findings/{findingId}/view3d", response_model=CloudViewOut)
async def put_finding_view3d(
    findingId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudViewOut:
    subject = await run_in_threadpool(views.finding_subject, handle, findingId)
    return await _store(request, handle, subject)


@sub.get("/findings/{findingId}/view3d", response_class=Response)
def get_finding_view3d(findingId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    views.require_finding(handle, findingId)
    return _image(*views.read_image(handle, "finding", findingId))


@sub.put("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d", response_model=CloudViewOut)
async def put_cloud_measurement_view3d(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> CloudViewOut:
    subject = await run_in_threadpool(views.measurement_subject, handle, cloudId, cloudMeasurementId)
    return await _store(request, handle, subject)


@sub.get("/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d", response_class=Response)
def get_cloud_measurement_view3d(
    cloudId: str,  # noqa: N803
    cloudMeasurementId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    views.measurement_subject(handle, cloudId, cloudMeasurementId)
    return _image(*views.read_image(handle, "cloud_measurement", cloudMeasurementId))


@sub.get("/pointclouds/{cloudId}/views", response_model=CloudViewList)
def list_cloud_views(cloudId: str, handle: ProjectHandle = Depends(get_project)) -> CloudViewList:  # noqa: N803
    return CloudViewList(items=views.list_for_cloud(handle, cloudId))
