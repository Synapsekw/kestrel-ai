# backend/app/asset_review/jobs_place.py
"""`asset_place` (spec 2026-10-02-asset-findings §6.3): back-project an asset model's sightings onto
its current version, then queue `asset_group`.

Bounded: the mesh is loaded once (J1 caches it per GLB). Sightings are read 64 at a time, ordered
by photo, so one preview-size photo (2,048 px, `app.datasets.images.image_file`) is in memory at a
time, and only for a sighting that needs a texture. Results are written 64 at a time; a cancel keeps
what was written, and `only_dirty` picks up the rest. A sighting whose photo has no pose stays
`pending`. J3 writes only the sighting's placement columns, never the finding's (J4 N3).
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from PIL import Image as PILImage
from sqlalchemy import or_, select

from app.asset_models import store
from app.asset_review import place
from app.asset_review.frame import Frame
from app.asset_review.jobs_group import live_group_job, submit_group
from app.asset_review.meshes import load_version_mesh
from app.asset_review.poses import PoseIn
from app.asset_review.profiles import ReviewConfig
from app.catalogue.handle import DEFAULT_SCALE
from app.datasets import images
from app.db.models import AssetModel, Box, Finding, FindingSighting, Image, ImagePose, Job
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

JOB_TYPE = "asset_place"
LIVE_STATES = ("queued", "running")
CHUNK = 64
PROGRESS_EVERY_S = 0.25
UNGRADED_COLOUR = "#9aa0a6"


def placements_dir(handle, asset_model_id: str, version: int) -> Path:
    """`asset_models/<id>/placements/v<n>/` (spec §5.7)."""
    return store.model_dir(handle, asset_model_id) / "placements" / f"v{int(version)}"


def severity_colours(catalogue) -> dict[int, str]:
    """Level -> `#rrggbb` from the catalogue's scale; D4's defaults when it is unavailable."""
    if catalogue is not None:
        try:
            from app.catalogue.service import get_scale

            return {lv.level: lv.colour for lv in get_scale(catalogue)}
        except Exception:  # the colours are cosmetic: never fail a placement over them
            pass
    return {lv: colour for lv, _, colour in DEFAULT_SCALE}


def _live(handle, asset_model_id: str) -> str | None:
    with handle.session() as s:
        for job_id, params in s.execute(
            select(Job.id, Job.params).where(Job.type == JOB_TYPE, Job.state.in_(LIVE_STATES))
        ):
            if (params or {}).get("asset_model_id") == asset_model_id:
                return job_id
    return None


def submit(handle, runner, asset_model_id: str, only_dirty: bool) -> Job:
    """Queue a placement run: 404 for an unknown model, 409 `not_ready` without a ready current
    version, 409 `job_running` while a placement or a grouping is live for the model."""
    with handle.session() as s:
        model = s.get(AssetModel, asset_model_id)
        if model is None:
            raise not_found("asset model", asset_model_id)
        version = (
            None
            if model.current_version is None
            else store.get_version(s, asset_model_id, model.current_version)
        )
        ready = version is not None and version.glb_status == "ready"
    if not ready:
        raise AppError(
            "not_ready", "The model's 3D file is not ready yet. Import or build it, then try again.", 409
        )
    live = _live(handle, asset_model_id) or live_group_job(handle, asset_model_id)
    if live is not None:
        raise AppError(
            "job_running",
            "Findings are already being placed or grouped on this model.",
            409,
            {"job_id": live},
        )
    return runner.submit(handle, JOB_TYPE, {"asset_model_id": asset_model_id, "only_dirty": bool(only_dirty)})


def _sighting_ids(s, asset_model_id: str, version: int, only_dirty: bool) -> list[str]:
    q = select(FindingSighting.id).where(FindingSighting.asset_model_id == asset_model_id)
    if only_dirty:
        q = q.where(
            or_(
                FindingSighting.placement == "pending",
                FindingSighting.placed_version.is_(None),
                FindingSighting.placed_version != version,
            )
        )
    return list(s.scalars(q.order_by(FindingSighting.image_id, FindingSighting.id)))


log = logging.getLogger(__name__)


def _geometry(box: Box) -> tuple:
    """What J4's hook reacts to: a change here makes the placement we are computing stale."""
    pts = None if box.points is None else [list(p) for p in box.points]
    return (box.class_id, box.shape, box.x, box.y, box.w, box.h, box.angle, pts)


def _load_chunk(s, ids: list[str], asset_model_id: str) -> list[dict]:
    """Plain values for one chunk, in the given order: the session closes before any ray is cast."""
    rows = s.execute(
        select(FindingSighting, Box, Image, ImagePose, Finding.severity)
        .join(Box, Box.id == FindingSighting.annotation_id)
        .join(Image, Image.id == FindingSighting.image_id)
        .outerjoin(Finding, Finding.id == FindingSighting.finding_id)
        .outerjoin(
            ImagePose,
            (ImagePose.image_id == FindingSighting.image_id) & (ImagePose.asset_model_id == asset_model_id),
        )
        .where(FindingSighting.id.in_(ids))
    ).all()
    by_id = {}
    for sg, box, image, pose, finding_severity in rows:
        item = {
            "id": sg.id,
            "geometry": _geometry(box),
            "image_id": image.id,
            "size": (int(image.width), int(image.height)),
            "shape": None,
            "severity": sg.severity if sg.severity is not None else finding_severity,
            "pose": None,
        }
        try:  # one bad row (an unknown pose source, a broken shape) must not fail the run
            item["shape"] = place.SightingShape.from_box(box)
            if pose is not None:
                item["pose"] = PoseIn(
                    position=list(pose.position),
                    target=list(pose.target),
                    up=list(pose.up),
                    hfov_deg=float(pose.hfov_deg),
                    vfov_deg=float(pose.vfov_deg),
                    source=pose.source,
                    accuracy_m=pose.accuracy_m,
                )
        except Exception:
            log.warning("sighting %s has unreadable geometry or pose; left pending", sg.id, exc_info=True)
            item["pose"] = None
        by_id[sg.id] = item
    return [by_id[i] for i in ids if i in by_id]


class _Photo:
    """The one photo in memory: the current image's preview, read only when a texture needs it."""

    def __init__(self, handle, log):
        self.handle, self.log = handle, log
        self.image_id: str | None = None
        self.image: PILImage.Image | None = None

    def get(self, image_id: str) -> PILImage.Image | None:
        if image_id != self.image_id:
            self.image_id, self.image = image_id, None
            try:
                with PILImage.open(images.image_file(self.handle, image_id, place.PREVIEW_SIDE)) as im:
                    self.image = im.convert("RGB")
            except (AppError, OSError) as e:  # a missing photo gives a plain-colour texture, not a failure
                self.log.warning("photo %s unreadable for a patch texture: %s", image_id, e)
        return self.image


def _write(handle, results: list[tuple[str, dict, tuple]]) -> list[str]:
    """Write one batch. A sighting whose box was deleted or edited since it was read is skipped: the
    edit left it `pending` (J4's hook), and writing now would overwrite that with the old geometry's
    placement. Returns the skipped ids."""
    skipped: list[str] = []
    if not results:
        return skipped
    with handle.session() as s:
        for sid, fields, geometry in results:
            r = s.get(FindingSighting, sid)
            box = None if r is None else s.get(Box, r.annotation_id)
            if r is None or box is None or _geometry(box) != geometry:
                skipped.append(sid)
                continue
            for k, v in fields.items():
                setattr(r, k, v)
    results.clear()
    return skipped


def _cleared(placement: str, version: int | None) -> dict:
    return {
        "placement": placement,
        "cx": None,
        "cy": None,
        "cz": None,
        "nx": None,
        "ny": None,
        "nz": None,
        "part": None,
        "patch_path": None,
        "placed_version": version,
    }


def _save_index(folder: Path, mid: str, version: int, index: dict) -> None:
    try:
        place.write_index(folder, mid, version, index)
    except OSError as e:  # derived and a reader may hold it; the next run rewrites it
        log.warning("could not write the placements index: %s", e)


def _remove_files(folder: Path, sid: str) -> None:
    for ext in (".bin", ".png", ".lbl"):
        try:
            (folder / f"{sid}{ext}").unlink(missing_ok=True)
        except OSError as e:  # a reader holds it open (Windows): derived, the next run removes it
            log.warning("could not remove %s%s: %s", sid, ext, e)


@register_job_type(JOB_TYPE)
def run_place(ctx) -> dict:
    handle = ctx.project
    mid = ctx.params["asset_model_id"]
    only_dirty = bool(ctx.params.get("only_dirty", False))
    with handle.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model no longer exists.")
        if model.current_version is None:
            raise JobFailure("The asset model has no version to place findings on.")
        if model.frame is None or model.review is None:
            raise JobFailure("Set the asset model's frame and review profile before placing findings.")
        version = int(model.current_version)
        frame = Frame.model_validate(model.frame)
        review = ReviewConfig.model_validate(model.review)
        ids = _sighting_ids(s, mid, version, only_dirty)
    ctx.progress(0, f"Placing {len(ids):,} sightings")
    counts = {"point": 0, "patch": 0, "none": 0, "no_pose": 0}
    folder = placements_dir(handle, mid, version)
    folder.mkdir(parents=True, exist_ok=True)
    index = place.read_index(folder)
    seen: set[str] = set()
    try:
        if ids:
            _place_all(ctx, handle, mid, version, ids, frame, review, folder, index, seen, counts)
    finally:
        _save_index(folder, mid, version, index)  # a cancel keeps the patches already written
    if not only_dirty:  # every sighting of the model was visited: drop what no longer exists
        index = {k: v for k, v in index.items() if k in seen}
        _save_index(folder, mid, version, index)
        _prune(folder, index)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    group_job_id = None
    try:
        group_job_id = submit_group(handle, ctx.runner, mid).id
    except AppError as e:  # a grouping already live, say: placing still succeeded
        ctx.log.warning("could not queue asset_group: %s", e)
    ctx.progress(
        1, f"Placed {counts['patch']:,} patches and {counts['point']:,} pins; {counts['none']:,} did not hit"
    )
    placed, unplaced = counts["point"] + counts["patch"], counts["none"] + counts["no_pose"]
    return {
        "asset_model_id": mid,
        "version": version,
        "placed": placed,
        "unplaced": unplaced,
        **counts,
        "group_job_id": group_job_id,
    }


def _place_all(ctx, handle, mid, version, ids, frame, review, folder, index, seen, counts) -> None:
    try:
        mesh, face_node = load_version_mesh(handle, mid, version)
    except AppError as e:
        raise JobFailure("The model's 3D file is not ready. Import or build it, then try again.") from e
    colours = severity_colours(getattr(ctx.runner, "catalogue", None))
    photo = _Photo(handle, ctx.log)
    pending: list[tuple[str, dict, tuple]] = []

    def flush() -> None:
        for sid in _write(handle, pending):  # edited mid-run: stays pending; drop its derived files
            index.pop(sid, None)
            _remove_files(folder, sid)

    last = 0.0
    done = 0
    try:
        for start in range(0, len(ids), CHUNK):
            with handle.session() as s:
                rows = _load_chunk(s, ids[start : start + CHUNK], mid)
            for r in rows:
                ctx.check_cancelled()
                sid = r["id"]
                seen.add(sid)
                if r["pose"] is None:  # stays dirty: `only_dirty` places it once the photo has a pose
                    counts["no_pose"] += 1
                    fields = _cleared("pending", None)
                    if r["shape"] is not None:
                        fields["coverage"] = r["shape"].area() / (r["size"][0] * r["size"][1])
                else:
                    shape = r["shape"]
                    needs_photo = place.wants_patch(shape, review.placement) and shape.outline() is not None
                    patch_path = None
                    try:
                        result = place.place_sighting(
                            mesh,
                            face_node,
                            r["pose"],
                            shape,
                            r["size"],
                            review,
                            photo.get(r["image_id"]) if needs_photo else None,
                            colours.get(r["severity"], UNGRADED_COLOUR),
                            frame=frame,
                        )
                        if result.patch is not None:
                            path = Path(place.write_patch(folder, sid, result.patch))
                            patch_path = path.relative_to(handle.folder).as_posix()
                    except Exception:  # one sighting never fails the run: it stays unplaced as `none`
                        ctx.log.exception("sighting %s could not be placed", sid)
                        result = place.Placement(kind="none", coverage=None)
                        patch_path = None
                    counts[result.kind] += 1
                    fields = _cleared(result.kind, version)
                    fields["coverage"] = result.coverage
                    if result.center is not None:
                        fields.update(zip(("cx", "cy", "cz"), result.center, strict=True))
                        fields.update(zip(("nx", "ny", "nz"), result.normal, strict=True))
                        fields["part"] = result.part
                    if patch_path is not None:
                        fields["patch_path"] = patch_path
                        index[sid] = place.index_entry(result.patch)
                if fields["patch_path"] is None:
                    index.pop(sid, None)
                    _remove_files(folder, sid)
                pending.append((sid, fields, r["geometry"]))
                done += 1
                if len(pending) >= CHUNK:
                    flush()
                now = time.monotonic()
                if now - last >= PROGRESS_EVERY_S:
                    last = now
                    ctx.progress(done / len(ids), f"Placed {done:,} of {len(ids):,} sightings")
    finally:
        flush()  # a cancel or a failure keeps every sighting already placed


def _prune(folder: Path, index: dict) -> None:
    """After a full run: patch files of sightings that are no longer patches, and other versions'
    folders (derived files, safe to delete, spec §5.7)."""
    for p in folder.iterdir():
        if p.suffix in (".bin", ".png", ".lbl") and p.stem not in index:
            try:
                p.unlink(missing_ok=True)
            except OSError as e:
                log.warning("could not prune %s: %s", p.name, e)
    for other in folder.parent.iterdir():
        if other.is_dir() and other != folder and other.name.startswith("v"):
            shutil.rmtree(other, ignore_errors=True)
