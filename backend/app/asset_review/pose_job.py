# backend/app/asset_review/pose_job.py
"""`asset_pose` (spec 2026-10-02-asset-findings §6.2): an `image_pose` row per photo in scope,
from the `image` pose columns. Column-only (no image file is opened), in keyset pages of PAGE
images. Rows with source `kit` or `manual` are never overwritten. A photo without GPS, or with no
yaw while standing on the asset axis, is skipped and named in the result; the job does not fail
for it (Review Focus 2)."""

from __future__ import annotations

from pathlib import PureWindowsPath

from sqlalchemy import func, select

from app.asset_review.frame import Frame
from app.asset_review.poses import has_gps, pose_from_exif
from app.db.base import utcnow
from app.db.models import AssetModel, Image, ImagePose, Job, Source
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

POSE_JOB = "asset_pose"
PAGE = 500
MAX_REPORTED = 200
KEEP_SOURCES = ("kit", "manual")


def live_pose_job(handle, runner, asset_model_id: str) -> str | None:
    """The id of a queued or running `asset_pose` job for this model that this process holds."""
    with handle.session() as s:
        rows = s.execute(
            select(Job.id, Job.params).where(Job.type == POSE_JOB, Job.state.in_(("queued", "running")))
        ).all()
    for job_id, params in rows:
        if (params or {}).get("asset_model_id") == asset_model_id and runner.is_live(job_id):
            return job_id
    return None


def sequence_of(image, source_labels: dict[str, str | None]) -> str | None:
    """The photo's folder inside its import (the kit's per-folder sequence), else its image set's label."""
    if image.original_name:
        parent = PureWindowsPath(image.original_name).parent.as_posix()
        if parent not in ("", "."):
            return parent
    return source_labels.get(image.source_id)


def _pages(handle, image_ids: list[str] | None):
    """Lists of at most PAGE image ids: the given ids in order without repeats, or every image by id."""
    if image_ids is not None:
        unique = list(dict.fromkeys(image_ids))
        for i in range(0, len(unique), PAGE):
            yield unique[i : i + PAGE]
        return
    last = ""
    while True:
        with handle.session() as s:
            page = list(s.scalars(select(Image.id).where(Image.id > last).order_by(Image.id).limit(PAGE)))
        if not page:
            return
        yield page
        last = page[-1]


@register_job_type(POSE_JOB)
def run_asset_pose(ctx) -> dict:
    mid = ctx.params["asset_model_id"]
    image_ids = ctx.params.get("image_ids")
    with ctx.project.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model was deleted.")
        frame = Frame.model_validate(model.frame) if model.frame else None
        labels = {src.id: (src.label or src.site or None) for src in s.scalars(select(Source))}
        total = (
            len(dict.fromkeys(image_ids))
            if image_ids is not None
            else s.scalar(select(func.count()).select_from(Image))
        )
    if frame is None or frame.origin is None:
        raise JobFailure("Set the asset's geographic origin (latitude, longitude, ground altitude) first.")
    counts = {"posed": 0, "axis_aimed": 0, "kept": 0, "no_altitude": 0}
    skipped: list[dict] = []
    skipped_count = 0
    done = 0
    ctx.progress(0, f"Estimating poses for {total:,} photos")
    for page in _pages(ctx.project, image_ids):
        with ctx.project.session() as s:
            found = {im.id: im for im in s.scalars(select(Image).where(Image.id.in_(page)))}
            existing = {
                p.image_id: p
                for p in s.scalars(
                    select(ImagePose).where(ImagePose.asset_model_id == mid, ImagePose.image_id.in_(page))
                )
            }
            for image_id in page:
                ctx.check_cancelled()
                done += 1
                image, old = found.get(image_id), existing.get(image_id)
                if image is not None and old is not None and old.source in KEEP_SOURCES:
                    counts["kept"] += 1
                    continue
                pose = pose_from_exif(image, frame) if image is not None else None
                if pose is None:
                    reason = "not_found" if image is None else ("no_gps" if not has_gps(image) else "on_axis")
                    skipped_count += 1
                    if len(skipped) < MAX_REPORTED:
                        name = (image.original_name or image.path) if image is not None else None
                        skipped.append({"image_id": image_id, "name": name, "reason": reason})
                    continue
                values = {
                    "position": list(pose.position),
                    "target": list(pose.target),
                    "up": list(pose.up),
                    "hfov_deg": pose.hfov_deg,
                    "vfov_deg": pose.vfov_deg,
                    "source": pose.source,
                    "accuracy_m": pose.accuracy_m,
                    "sequence": sequence_of(image, labels),
                    "updated_at": utcnow(),
                }
                if old is None:
                    s.add(ImagePose(image_id=image_id, asset_model_id=mid, **values))
                else:
                    for k, v in values.items():
                        setattr(old, k, v)
                counts["posed" if pose.source == "exif_gimbal" else "axis_aimed"] += 1
                if image.alt is None:
                    counts["no_altitude"] += 1
        ctx.progress(
            done / max(total, 1), f"Posed {counts['posed'] + counts['axis_aimed']:,} of {total:,} photos"
        )
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    return {
        "asset_model_id": mid,
        "total": total,
        "estimated": counts["posed"] + counts["axis_aimed"],
        **counts,
        "skipped": skipped_count,
        "skipped_images": skipped,
    }
