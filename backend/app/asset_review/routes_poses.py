"""Photo poses for an asset model (spec 2026-10-02-asset-findings §8): the paged list for the
cameras layer, the `asset_pose` job, and a manual pose."""

from __future__ import annotations

import math

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy import select

from app.asset_models import store
from app.asset_review.effective import effective_status
from app.asset_review.pose_job import POSE_JOB, live_pose_job
from app.asset_review.pose_schemas import (
    ImagePoseIn,
    ImagePoseList,
    ImagePoseOut,
    PoseEstimateRequest,
    PoseJobRef,
)
from app.db.base import utcnow
from app.db.models import Image, ImagePose
from app.errors import AppError, not_found
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
P = "/asset-models/{assetModelId}/poses"
MAX_PAGE = 2000
DEFAULT_PAGE = 500  # the contract's `assetPageLimit` default
MAX_IMAGE_FILTER = 100
MIN_LENGTH = 1e-6


@router.get(P, response_model=ImagePoseList)
def list_image_poses(
    assetModelId: str,  # noqa: N803
    after: str | None = Query(None, max_length=64),
    limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    sequence: str | None = Query(None, max_length=120),
    image_id: list[str] | None = Query(None, max_length=MAX_IMAGE_FILTER),
    handle: ProjectHandle = Depends(get_project),
) -> ImagePoseList:
    with handle.session() as s:
        store.get_model(s, assetModelId)
        q = (
            select(ImagePose, effective_status())
            .join(Image, Image.id == ImagePose.image_id)
            .where(ImagePose.asset_model_id == assetModelId)
        )
        if after:
            q = q.where(ImagePose.image_id > after)
        if sequence is not None:
            q = q.where(ImagePose.sequence == sequence)
        if image_id:
            q = q.where(ImagePose.image_id.in_(image_id))
        rows = s.execute(q.order_by(ImagePose.image_id).limit(limit + 1)).all()
        items = [ImagePoseOut.of(pose, status) for pose, status in rows[:limit]]
    more = len(rows) > limit
    return ImagePoseList(items=items, next=items[-1].image_id if more else None)


@router.post(P + "/estimate", response_model=PoseJobRef, status_code=202)
def estimate_image_poses(
    assetModelId: str,  # noqa: N803
    request: Request,
    body: PoseEstimateRequest | None = Body(None),
    handle: ProjectHandle = Depends(get_project),
) -> PoseJobRef:
    with handle.session() as s:
        frame = store.get_model(s, assetModelId).frame
    if not frame or not frame.get("origin"):
        raise AppError(
            "no_origin",
            "Set the asset's geographic origin (latitude, longitude and ground altitude) "
            "before estimating poses.",
            422,
        )
    runner = request.app.state.jobs
    live = live_pose_job(handle, runner, assetModelId)
    if live:
        raise AppError(
            "job_running", "Poses are already being estimated for this model.", 409, {"job_id": live}
        )
    image_ids = body.image_ids if body is not None else None
    job = runner.submit(handle, POSE_JOB, {"asset_model_id": assetModelId, "image_ids": image_ids})
    return PoseJobRef(job=JobOut.from_row(job, handle.id))


def _check_pose(body: ImagePoseIn) -> None:
    d = [body.target[i] - body.position[i] for i in range(3)]
    u = body.up
    cross = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
    nd, nu = math.sqrt(sum(v * v for v in d)), math.sqrt(sum(v * v for v in u))
    if nd < MIN_LENGTH:
        raise AppError("invalid_pose", "The target must differ from the camera position.", 422)
    if body.hfov_deg >= 180 or body.vfov_deg >= 180:
        raise AppError("invalid_pose", "A field of view must be narrower than 180 degrees.", 422)
    if nu < MIN_LENGTH or math.sqrt(sum(v * v for v in cross)) < MIN_LENGTH * nd * nu:
        raise AppError("invalid_pose", "The up vector must not point along the view direction.", 422)


@router.put(P + "/{imageId}", response_model=ImagePoseOut)
def put_image_pose(
    assetModelId: str,  # noqa: N803
    imageId: str,  # noqa: N803
    body: ImagePoseIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImagePoseOut:
    with handle.session() as s:
        store.get_model(s, assetModelId)
        if s.get(Image, imageId) is None:
            raise not_found("image", imageId)
        _check_pose(body)
        values = {
            "position": list(body.position),
            "target": list(body.target),
            "up": list(body.up),
            "hfov_deg": body.hfov_deg,
            "vfov_deg": body.vfov_deg,
            "source": "manual",
            "accuracy_m": body.accuracy_m,
            "sequence": body.sequence,
            "updated_at": utcnow(),
        }
        row = s.get(ImagePose, {"image_id": imageId, "asset_model_id": assetModelId})
        if row is None:
            row = ImagePose(image_id=imageId, asset_model_id=assetModelId, **values)
            s.add(row)
        else:
            for k, v in values.items():
                setattr(row, k, v)
        s.flush()
        status = s.scalar(select(effective_status()).select_from(Image).where(Image.id == imageId))
        out = ImagePoseOut.of(row, status)
    publish_asset_models_changed(request, handle, [assetModelId])
    return out
