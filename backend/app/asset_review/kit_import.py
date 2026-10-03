"""`review_kit_import` (spec 2026-10-02-asset-findings §6.5): a review kit's job folder into an
asset model of this project.

`POST /review-imports` checks the request and queues this job. Every run first reads the kit and
matches its photos to the chosen image set (one header read per matched photo, no pixels). A dry
run stops there and returns the preview as the job result, writing nothing (index Review Focus 3).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select

from app.asset_models import store as asset_store
from app.asset_review import glb_import
from app.asset_review.kit_children import InlineRunner
from app.asset_review.kit_format import STATUSES, UNCLASSIFIED, Kit, KitError, preview_size, read_kit
from app.asset_review.kit_match import Match, load_candidates, match_photos
from app.asset_review.kit_records import write_frame, write_poses, write_statuses
from app.asset_review.kit_replay import mark_unplaced, placement_counts, replay
from app.asset_review.kit_sightings import Written, plan_sightings, undo_records, write_sightings
from app.db.models import AssetModel, AssetModelVersion, FindingSighting, Job, ProjectType, Source
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

JOB = "review_kit_import"
MAX_LISTED = 2000  # unmatched reasons and skipped lists in a job result; the counts are always whole
MAX_NAMES = 500  # C0's `ReviewImportPreview.unmatched` maxItems
LIVE_STATES = ("queued", "running")
ASPECT_TOLERANCE = 0.02  # a matched image whose aspect differs more than this is not the kit's photo


@dataclass
class Prepared:
    matches: dict[str, Match] = field(default_factory=dict)
    unmatched: list[dict] = field(default_factory=list)
    previews: dict[str, tuple[int, int]] = field(default_factory=dict)


def check_request(handle, body: dict) -> dict:
    """The route's cheap checks; returns the job params. The kit itself is read by the job."""
    folder = Path(str(body.get("folder") or ""))
    if not folder.is_absolute() or not folder.is_dir():
        raise AppError("kit_invalid", f"{folder} is not a folder on this PC.", 422, {"missing": []})
    if not (folder / "job.yaml").is_file():
        raise AppError(
            "kit_invalid",
            "The folder has no job.yaml. Pick the kit's job folder.",
            422,
            {"missing": ["job.yaml"]},
        )
    model_id = body.get("asset_model_id") or None
    name = (body.get("new_model_name") or "").strip() or None
    if bool(model_id) == bool(name):
        raise AppError("validation_error", "Give either an asset model to fill or a name for a new one.", 422)
    with handle.session() as s:
        if s.get(Source, body["image_source_id"]) is None:
            raise not_found("image source", body["image_source_id"])
        if model_id:
            asset_store.get_model(s, model_id)
        if not body.get("dry_run"):
            live = s.execute(
                select(Job.id, Job.params).where(Job.type == JOB, Job.state.in_(LIVE_STATES))
            ).all()
            for job_id, job_params in live:
                if not (job_params or {}).get("dry_run"):
                    raise AppError(
                        "job_running",
                        "A review kit import is already running in this project.",
                        409,
                        {"job_id": job_id},
                    )
    return {
        "folder": str(folder),
        "image_source_id": body["image_source_id"],
        "asset_model_id": model_id,
        "new_model_name": name,
        "class_map": {str(k): str(v) for k, v in (body.get("class_map") or {}).items()},
        "dry_run": bool(body.get("dry_run")),
    }


def prepare(ctx, kit: Kit) -> Prepared:
    """Match the kit's photos and read each matched photo's preview grid (headers only)."""
    with ctx.project.session() as s:
        candidates = load_candidates(s, ctx.params["image_source_id"])
    result = match_photos(kit.photos, candidates)
    photos = {p.id: p for p in kit.photos}
    prep = Prepared(unmatched=list(result.unmatched))
    total = max(1, len(result.matched))
    for i, (kit_id, m) in enumerate(result.matched.items()):
        if i % 200 == 0:
            ctx.check_cancelled()
            ctx.progress(0.01 + 0.03 * i / total, f"Matching photos {i:,} / {total:,}")
        pw, ph = preview_size(kit, photos[kit_id])
        sx, sy = m.width / pw, m.height / ph
        if abs(sx / sy - 1) > ASPECT_TOLERANCE:
            prep.unmatched.append(
                {"kit_id": kit_id, "source_name": photos[kit_id].source_name, "reason": "size_mismatch"}
            )
            continue
        prep.matches[kit_id] = m
        prep.previews[kit_id] = (pw, ph)
    return prep


def sighting_keys(kit: Kit, matches) -> Counter:
    """How many sightings each kit class key would give, over the matched photos only."""
    keys: Counter = Counter()
    if kit.unit == "region":
        for f in kit.findings:
            if f.photo in matches:
                keys[f.cls or UNCLASSIFIED] += 1
    else:
        for kit_id in matches:
            st = kit.status_of(kit_id)
            if st["status"] == "finding":
                keys[kit.photo_unit_key(st["severity"])] += 1
    return keys


def defect_types(s) -> list[tuple[str, str]]:
    q = (
        select(ProjectType.type_id, ProjectType.name)
        .where(ProjectType.kind == "defect")
        .order_by(ProjectType.position)
    )
    return [(tid, name) for tid, name in s.execute(q).all()]


def suggest_type(key: str, label: str, types: list[tuple[str, str]]) -> str | None:
    """A defect type whose name is the key or the label, else one with the key as a word."""
    k, lab = key.lower(), label.lower()
    for tid, name in types:
        if name.lower() in (k, lab):
            return tid
    for tid, name in types:
        if k in name.lower().split():
            return tid
    return None


def ready_version(s, asset_model_id: str) -> int | None:
    model = s.get(AssetModel, asset_model_id)
    if model is None or model.current_version is None:
        return None
    v = s.scalar(
        select(AssetModelVersion).where(
            AssetModelVersion.model_id == asset_model_id, AssetModelVersion.version == model.current_version
        )
    )
    return model.current_version if v is not None and v.glb_status == "ready" else None


def existing_sightings(s, asset_model_id: str) -> int:
    q = (
        select(func.count())
        .select_from(FindingSighting)
        .where(FindingSighting.asset_model_id == asset_model_id)
    )
    return int(s.scalar(q) or 0)


def build_preview(handle, kit: Kit, prep: Prepared, params: dict) -> dict:
    statuses = Counter(kit.status_of(k)["status"] for k in prep.matches)
    keys = sighting_keys(kit, prep.matches)
    labels = {c.key: c.label for c in kit.classes}
    class_map = params.get("class_map") or {}
    mid = params.get("asset_model_id")
    with handle.session() as s:
        types = defect_types(s)
        ready = ready_version(s, mid) if mid else None
        existing = existing_sightings(s, mid) if mid else 0
    return {
        "dry_run": True,
        **photo_fields(kit, prep),
        "statuses": {st: statuses.get(st, 0) for st in STATUSES},
        "classes": [
            {
                "key": k,
                "label": labels.get(k, k),
                "count": n,
                "type_id": class_map.get(k) or suggest_type(k, labels.get(k, k), types),
            }
            for k, n in keys.most_common()
        ],
        "sightings": sum(keys.values()),
        "has_surface": kit.surface_path is not None,
        "has_glb": kit.glb_path is not None,
        "has_merged": (kit.folder / "merged.json").is_file(),
        "model": {"ready_version": ready, "existing_sightings": existing},
    }


def photo_fields(kit: Kit, prep: Prepared) -> dict:
    """The photo match as C0's `ReviewImportPreview` names it, plus the reasons (J5's addition)."""
    return {
        "unit": kit.unit,
        "profile": kit.kit_profile,
        "profile_id": kit.profile_id,
        "photos": len(kit.photos),
        "matched": len(prep.matches),
        "matched_by": dict(Counter(m.by for m in prep.matches.values())),
        "unmatched_count": len(prep.unmatched),
        "unmatched": [u["source_name"] for u in prep.unmatched[:MAX_NAMES]],
        "unmatched_reasons": prep.unmatched[:MAX_LISTED],
    }


@register_job_type(JOB)
def run_kit_import(ctx) -> dict:
    ctx.progress(0, "Reading the kit folder")
    try:
        kit = read_kit(Path(ctx.params["folder"]))
        prep = prepare(ctx, kit)
        if ctx.params.get("dry_run"):
            ctx.progress(1, f"Matched {len(prep.matches):,} of {len(kit.photos):,} kit photos")
            return build_preview(ctx.project, kit, prep, ctx.params)
        return _import(ctx, kit, prep)
    except KitError as e:
        raise JobFailure(str(e)) from None


def _validate(handle, kit: Kit, prep: Prepared, params: dict) -> dict[str, str]:
    """Everything that can refuse the import, before any write. Returns the class map for the
    keys this kit uses."""
    if not prep.matches:
        raise JobFailure("No kit photo matches an image in this image set. Run a dry run to see why.")
    keys = sighting_keys(kit, prep.matches)
    class_map = params.get("class_map") or {}
    missing = sorted(k for k in keys if k not in class_map)
    if missing:
        raise JobFailure("Map every kit class to a defect type first: " + ", ".join(missing) + ".")
    mid = params.get("asset_model_id")
    with handle.session() as s:
        defect = {tid for tid, _ in defect_types(s)}
        if {class_map[k] for k in keys} - defect:
            raise JobFailure("The class mapping names a type that is not a defect type in this project.")
        ready = None
        if mid:
            if s.get(AssetModel, mid) is None:
                raise JobFailure("The asset model was deleted before the import started.")
            n = existing_sightings(s, mid)
            if n:
                raise JobFailure(
                    f"This asset model already holds {n:,} sightings from an earlier import. "
                    "Import into a new asset model."
                )
            ready = ready_version(s, mid)
    if ready is None and kit.glb_path is None:
        raise JobFailure(
            "The asset model has no 3D model yet and the kit folder has no model.glb. "
            "Import the GLB into the asset model first."
        )
    return {k: class_map[k] for k in keys}


def _target_model(handle, params: dict, kit: Kit) -> str:
    if params.get("asset_model_id"):
        return params["asset_model_id"]
    with handle.session() as s:
        row = AssetModel(name=params["new_model_name"], asset_type=kit.kit_profile, status="empty")
        s.add(row)
        s.flush()
        return row.id


def _ensure_version(ctx, asset_model_id: str, kit: Kit) -> int:
    """The model's ready version; without one, the kit's model.glb is imported here, in this job,
    through J1's `start_import` (spec §6.1). The kit's frame is the canonical one (X north, Y up,
    Z east), so the conversion is `none`."""
    with ctx.project.session() as s:
        v = ready_version(s, asset_model_id)
    if v is not None:
        return v
    try:
        glb_import.check_source(kit.glb_path)
    except AppError as e:
        raise JobFailure(f"The kit's model.glb cannot be imported: {e.message}") from None
    ctx.progress(0.05, "Importing the kit's 3D model")
    glb_import.start_import(
        ctx.project,
        InlineRunner(ctx, 0.05, 0.11),
        asset_model_id,
        path=kit.glb_path,
        conversion="none",
        origin=None,
        note="Imported with a review kit",
        source_name=kit.glb_path.name,
    )
    with ctx.project.session() as s:
        v = ready_version(s, asset_model_id)
    if v is None:
        raise JobFailure("The kit's model.glb could not be imported as the asset model's 3D model.")
    return v


def _result(kit: Kit, prep: Prepared, asset_model_id: str, version: int, **parts) -> dict:
    return {
        "dry_run": False,
        "asset_model_id": asset_model_id,
        "version": version,
        **photo_fields(kit, prep),
        **parts,
    }


def _scales(prep: Prepared, written: list[Written]) -> dict[str, tuple[float, float]]:
    """Stored-image px per kit preview px, per sighting (for J3's patch crop)."""
    out = {}
    for w in written:
        m, (pw, ph) = prep.matches[w.kit_photo], prep.previews[w.kit_photo]
        out[w.sighting_id] = (m.width / pw, m.height / ph)
    return out


def _import(ctx, kit: Kit, prep: Prepared) -> dict:
    handle, params = ctx.project, ctx.params
    class_map = _validate(handle, kit, prep, params)
    mid = _target_model(handle, params, kit)
    version = _ensure_version(ctx, mid, kit)
    ctx.progress(0.12, "Writing the asset frame and review profile")
    write_frame(handle, mid, kit)
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    pose_ids: list[str] = []
    written: list[Written] = []
    skipped: list[dict] = []
    try:
        poses = write_poses(handle, ctx, mid, kit, prep.matches, pose_ids)
        planned = plan_sightings(ctx, kit, prep.matches, prep.previews, class_map, skipped)
        write_sightings(handle, ctx, mid, planned, written, skipped)
        statuses = write_statuses(handle, ctx, kit, prep.matches, skipped)
    except Exception:
        undo_records(handle, mid, written, pose_ids)  # cancel included: JobCancelled is an Exception
        raise
    ids = [w.sighting_id for w in written]
    placement: dict = {"mode": "none"}
    if kit.surface_path is not None:
        ctx.progress(0.5, "Replaying the kit's placements")
        keys = {w.kit_key: w.sighting_id for w in written if w.primary}
        extra = replay(handle, ctx, mid, version, kit, keys, 0.5, 0.8, scales=_scales(prep, written))
        mark_unplaced(handle, [w.sighting_id for w in written if not w.primary], version)
        placement = {"mode": "replay", **extra}
    placement.update(placement_counts(handle, ids))
    ctx.progress(1, f"Imported {len(written):,} sightings")
    return _result(
        kit,
        prep,
        mid,
        version,
        poses=poses,
        statuses=statuses,
        sightings=len(written),
        skipped=skipped[:MAX_LISTED],
        placement=placement,
    )
