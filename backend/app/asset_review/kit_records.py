"""Frame, review profile, camera poses and photo statuses from a kit (spec 2026-10-02-asset-findings
§6.5 steps 1, 3 and 4). Writes go in chunks of at most 500 rows per commit."""

from __future__ import annotations

import math

from app.asset_models import store as asset_store
from app.asset_review import profiles
from app.asset_review.frame import Frame, Origin
from app.asset_review.kit_format import STATUSES, Kit, number
from app.asset_review.kit_match import Match
from app.asset_review.review_status import set_status
from app.db.base import utcnow
from app.db.models import ImagePose
from app.errors import AppError

EARTH_RADIUS_M = 6378137.0  # kit/cameras.py
DEFAULT_HEIGHT_M = 50.0  # kit/records.py, when neither the job nor the model gives a height
POSE_CHUNK = 500
STATUS_CHUNK = 500
NOTE_MAX = 2000


def kit_origin(alignment: dict) -> Origin | None:
    """The base centre in WGS84. DAMAC's kit writes `origin: [lat, lon, ground_alt]`. EBSM's
    review package writes a reference point and the stack centre's east and north offset from it,
    in metres; its model frame has the stack axis at x = z = 0."""
    o = alignment.get("origin")
    if isinstance(o, list | tuple) and len(o) >= 2:
        return Origin(lat=float(o[0]), lon=float(o[1]), ground_alt_m=float(o[2]) if len(o) > 2 else 0.0)
    if alignment.get("reference_latitude") is not None and alignment.get("reference_longitude") is not None:
        lat, lon = float(alignment["reference_latitude"]), float(alignment["reference_longitude"])
        east, north = (float(v) for v in list(alignment.get("stack_center_EN") or (0.0, 0.0))[:2])
        lat += math.degrees(north / EARTH_RADIUS_M)
        lon += math.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
        return Origin(lat=lat, lon=lon, ground_alt_m=float(alignment.get("ground_altitude_assumed") or 0.0))
    return None


def _preset(p: dict) -> dict:
    return {
        "id": str(p["id"]),
        "label": str(p.get("label") or p["id"]),
        "target": [float(v) for v in p["target"]],
        "camera": [float(v) for v in p["camera"]],
    }


def frame_from_kit(kit: Kit, existing: dict | None) -> Frame:
    """The kit's `job.asset` over the model's current frame (J1 wrote the mesh's height and
    silhouette on import); a field the kit does not give keeps the model's value."""
    base = dict(existing or {})
    a = kit.asset
    silhouette = (
        [[float(y), float(r)] for y, r in a["silhouette"]]
        if a.get("silhouette")
        else list(base.get("silhouette") or [])
    )
    height = (
        number(a.get("height"))
        or number(base.get("height_m"))
        or (max(float(y) for y, _ in silhouette) if silhouette else None)
        or DEFAULT_HEIGHT_M
    )
    origin = kit_origin(kit.alignment)
    data = {
        "origin": origin.model_dump() if origin is not None else base.get("origin"),
        "north_offset_deg": float(base.get("north_offset_deg") or 0.0),
        "height_m": float(height),
        "datum_label": str(a.get("datum_label") or base.get("datum_label") or "Ground"),
        "datum_note": str(a.get("datum_note") or base.get("datum_note") or ""),
        "line_azimuth_deg": (
            number(a["line_azimuth_deg"])
            if a.get("line_azimuth_deg") is not None
            else base.get("line_azimuth_deg")
        ),
        "silhouette": silhouette,
        "levels": [float(v) for v in (a.get("levels") or base.get("levels") or [])],
        "presets": [_preset(p) for p in a["presets"]]
        if a.get("presets")
        else list(base.get("presets") or []),
    }
    return Frame.model_validate(data)


def review_from_kit(kit: Kit, height_m: float) -> profiles.ReviewConfig:
    """The built-in profile for the kit's profile, with the job's zones (metres, open ends allowed)
    and the job's `profile.cluster_m` and `profile.patch_grid` when it sets them."""
    overrides: dict = {}
    if kit.asset.get("zones"):
        overrides["zones"] = [dict(z) for z in kit.asset["zones"]]
    for key in ("cluster_m", "patch_grid"):
        if kit.profile_overrides.get(key) is not None:
            overrides[key] = kit.profile_overrides[key]
    return profiles.resolve(kit.profile_id, height_m, overrides or None)


def write_frame(handle, asset_model_id: str, kit: Kit) -> tuple[Frame, profiles.ReviewConfig]:
    with handle.session() as s:
        model = asset_store.get_model(s, asset_model_id)
        frame = frame_from_kit(kit, model.frame)
        review = review_from_kit(kit, frame.height_m)
        model.frame = frame.model_dump(mode="json")
        model.review = review.model_dump(mode="json")
    return frame, review


def write_poses(
    handle, ctx, asset_model_id: str, kit: Kit, matches: dict[str, Match], pose_ids: list[str]
) -> dict:
    """`cameras.json` poses as `image_pose` rows with `source = kit` (spec §6.5 step 3). A manual
    pose is the operator's and is kept. `pose_ids` collects the images written, for the undo."""
    photos = {p.id: p for p in kit.photos}
    items = list(matches.items())
    out = {"written": 0, "kept_manual": 0, "missing": 0}
    for start in range(0, len(items), POSE_CHUNK):
        ctx.check_cancelled()
        with handle.session() as s:
            for kit_id, m in items[start : start + POSE_CHUNK]:
                p = photos[kit_id]
                if p.position is None or p.target is None or p.hfov is None or p.vfov is None:
                    out["missing"] += 1
                    continue
                row = s.get(ImagePose, {"image_id": m.image_id, "asset_model_id": asset_model_id})
                if row is not None and row.source == "manual":
                    out["kept_manual"] += 1
                    continue
                if row is None:
                    row = ImagePose(image_id=m.image_id, asset_model_id=asset_model_id)
                    s.add(row)
                row.position, row.target, row.up = list(p.position), list(p.target), list(p.up)
                row.hfov_deg, row.vfov_deg = p.hfov, p.vfov
                row.source, row.accuracy_m = "kit", None
                row.sequence = kit.sequences.get(p.sequence, p.sequence)
                row.updated_at = utcnow()
                pose_ids.append(m.image_id)
                out["written"] += 1
        done = min(start + POSE_CHUNK, len(items))
        ctx.progress(
            0.12 + 0.03 * done / max(1, len(items)), f"Writing camera poses {done:,} / {len(items):,}"
        )
    return out


def _fraction(percent: float | None) -> float | None:
    return None if percent is None else round(float(percent) / 100.0, 6)


def write_statuses(
    handle, ctx, kit: Kit, matches: dict[str, Match], skipped: list[dict] | None = None
) -> dict[str, int]:
    """`assessment.json` photo statuses as `image_review` rows (spec §6.5 step 4). A matched photo
    the assessment does not list is `not_assessed`, as the kit reads it. Coverage is stored as a
    share (the kit writes percent). A photo whose status the app refuses (a `none` on a photo with
    ground truth is a 409) is left as it was and listed in `skipped`, so one photo never undoes the
    import."""
    items = list(matches.items())
    counts = dict.fromkeys(STATUSES, 0)
    for start in range(0, len(items), STATUS_CHUNK):
        ctx.check_cancelled()
        with handle.session() as s:
            for kit_id, m in items[start : start + STATUS_CHUNK]:
                st = kit.status_of(kit_id)
                try:
                    with s.begin_nested():
                        row = set_status(s, m.image_id, st["status"], st["note"][:NOTE_MAX])
                except AppError:
                    if skipped is not None:
                        skipped.append({"kit_key": kit_id, "reason": "status_conflict"})
                    continue
                row.coverage = _fraction(st["coverage"])
                row.uncertain_coverage = _fraction(st["uncertain"])
                counts[st["status"]] += 1
        done = min(start + STATUS_CHUNK, len(items))
        ctx.progress(
            0.45 + 0.05 * done / max(1, len(items)), f"Writing photo statuses {done:,} / {len(items):,}"
        )
    ctx.publish("images.changed", {})
    return counts
