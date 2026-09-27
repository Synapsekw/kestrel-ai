"""Stored report views (spec 2026-09-26-point-cloud-workspace section 11; reports spec section 9.4).

Every cloud finding and cloud measurement keeps one picture the workspace rendered (the backend
cannot render the BROTLI octree), with the pose and render settings that took it. The file lives at
`pointclouds/<cloud_id>/views/<subject_kind>-<subject_id>.<png|jpg>`, written through
`views/.partial-<hex>` and an atomic replace, then the `cloud_view` row is upserted. `stale` is
computed on read from `anchor_hash`. R's report job reads views in-process through `stored_view`.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image as PILImage
from PIL import UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.base import utcnow
from app.db.models import CloudMeasurement, CloudView, Finding
from app.errors import AppError, not_found
from app.pointclouds import rows
from app.pointclouds.schemas import CloudViewMeta, CloudViewOut
from app.projects.service import ProjectHandle

log = logging.getLogger(__name__)

WIDTH, HEIGHT = 1600, 1000  # R's print size, aspect 1.6 (spec section 11.1)
MAX_BYTES = 6 * 1024 * 1024
MAX_META_BYTES = 64 * 1024
MAX_LISTED = 1500  # 500 pins + 1 000 measurements (spec section 13)
SWEEP_GRACE_S = 60.0  # a sweep never touches a file younger than this: it may be an in-flight PUT's
PARTIAL = ".partial-"
FORMATS = {"PNG": ("png", "image/png"), "JPEG": ("jpg", "image/jpeg")}
MEDIA = {"png": "image/png", "jpg": "image/jpeg"}
VIEW_FILE = re.compile(r"^(finding|cloud_measurement)-[0-9A-Za-z-]+\.(png|jpg)$")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _mm(v: float) -> int:
    return round(float(v) * 1000)


def finding_hash(x: float, y: float, z: float) -> str:
    """A cloud finding's anchor, rounded to the millimetre."""
    return _sha(json.dumps([_mm(x), _mm(y), _mm(z)]))


def measurement_hash(points: list[dict]) -> str:
    """A measurement's points (millimetres) and their rings `group`; `uncertainty_m` is not geometry."""
    return _sha(json.dumps([[_mm(p["x"]), _mm(p["y"]), _mm(p["z"]), p.get("group")] for p in points]))


def bad_image(reason: str, message: str) -> AppError:
    return AppError("bad_view_image", message, 422, {"reason": reason})


def check_image(data: bytes) -> str:
    """The extension (`png` | `jpg`) of a valid view image, else 422 `bad_view_image {reason}`.

    Bounded: the size cap first, then Pillow's header read, then (only at exactly 1600 x 1000) one
    decode, which catches truncated or corrupt pixel data."""
    if len(data) > MAX_BYTES:
        raise bad_image("too_large", f"the view is {len(data) / 1024 / 1024:.1f} MiB; the limit is 6 MiB")
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            fmt, size = im.format, im.size
            if fmt not in FORMATS:
                raise bad_image("wrong_format", f"the view is a {fmt} image; send a PNG or a JPEG")
            if size != (WIDTH, HEIGHT):
                raise bad_image("wrong_size", f"the view is {size[0]} x {size[1]}; it must be 1600 x 1000")
            im.load()
    except AppError:
        raise
    except (UnidentifiedImageError, PILImage.DecompressionBombError, OSError, SyntaxError, ValueError) as e:
        raise bad_image("not_an_image", "the view is not a readable PNG or JPEG") from e
    return FORMATS[fmt][0]


def _invalid(message: str) -> AppError:
    return AppError("validation_error", message, 422)


def parse_meta(raw: str | bytes, subject_kind: str) -> CloudViewMeta:
    """The upload's `meta` part, validated; every number finite; a finding's normal made unit length
    (null when zero), a measurement's dropped (spec section 9.1: findings only)."""
    size = len(raw.encode("utf-8")) if isinstance(raw, str) else len(raw)
    if size > MAX_META_BYTES:
        raise _invalid("the view's meta is over 64 KiB")
    try:
        meta = CloudViewMeta.model_validate_json(raw)
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise _invalid(f"the view's meta is not valid: {where} {first.get('msg', '')}".strip()) from e
    pose, render = meta.pose, meta.render
    numbers = [*pose.position, *pose.target, *pose.up, pose.fov_deg, render.point_size]
    numbers += list(meta.anchor_normal or [])
    if render.clip_box is not None:
        numbers += [*render.clip_box.centre, *render.clip_box.size, render.clip_box.yaw_deg]
    if not all(math.isfinite(v) for v in numbers):
        raise _invalid("the view's meta has a number that is not finite")
    normal = None
    if subject_kind == "finding" and meta.anchor_normal is not None:
        length = math.sqrt(sum(v * v for v in meta.anchor_normal))
        normal = [v / length for v in meta.anchor_normal] if length > 1e-9 else None
    return meta.model_copy(update={"anchor_normal": normal})


# ------------------------------------------------------------------ subjects


@dataclass(frozen=True)
class Subject:
    """What a view belongs to: `kind` is `finding` | `cloud_measurement`."""

    kind: str
    id: str
    cloud_id: str
    anchor_hash: str


@dataclass(frozen=True)
class StoredView:
    """A stored view as R's report job reads it in-process (reports spec section 9.4)."""

    meta: CloudViewOut
    path: Path
    media_type: str


def views_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return rows.cloud_dir(handle, cloud_id) / "views"


def _column(subject_kind: str):
    return CloudView.finding_id if subject_kind == "finding" else CloudView.cloud_measurement_id


def finding_subject(handle: ProjectHandle, finding_id: str) -> Subject:
    """404 `not_found`; 409 `not_a_cloud_finding` for an image or map finding."""
    with handle.session() as s:
        f = s.get(Finding, finding_id)
        if f is None:
            raise not_found("finding", finding_id)
        if f.anchor_kind != "cloud" or f.cloud_id is None:
            raise AppError(
                "not_a_cloud_finding",
                f"this finding is anchored on {f.anchor_kind}, not on a point cloud; it has no 3D view",
                409,
            )
        return Subject("finding", f.id, f.cloud_id, finding_hash(f.x, f.y, f.z))


def require_finding(handle: ProjectHandle, finding_id: str) -> None:
    with handle.session() as s:
        if s.get(Finding, finding_id) is None:
            raise not_found("finding", finding_id)


def measurement_subject(handle: ProjectHandle, cloud_id: str, measurement_id: str) -> Subject:
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        m = s.get(CloudMeasurement, measurement_id)
        if m is None or m.point_cloud_id != cloud_id:
            raise not_found("measurement", measurement_id)
        return Subject("cloud_measurement", m.id, cloud_id, measurement_hash(m.points))


# ------------------------------------------------------------------ rows out


def _out(row: CloudView, current_hash: str | None) -> CloudViewOut:
    kind, sid = (
        ("finding", row.finding_id) if row.finding_id else ("cloud_measurement", row.cloud_measurement_id)
    )
    return CloudViewOut(
        subject_kind=kind,
        subject_id=sid,
        pose=row.pose,
        render=row.render,
        anchor_normal=row.anchor_normal,
        sha256=row.sha256,
        bytes=row.bytes,
        width=row.width,
        height=row.height,
        captured_at=row.captured_at,
        stale=current_hash != row.anchor_hash,
    )


def _current_hash(s, row: CloudView) -> str | None:
    if row.finding_id:
        f = s.get(Finding, row.finding_id)
        return finding_hash(f.x, f.y, f.z) if f is not None else None
    m = s.get(CloudMeasurement, row.cloud_measurement_id)
    return measurement_hash(m.points) if m is not None else None


def _unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        log.warning("could not remove the report view %s; the sweep will retry", path, exc_info=True)


# ------------------------------------------------------------------ write


def store(handle: ProjectHandle, subject: Subject, data: bytes, meta: CloudViewMeta) -> CloudViewOut:
    """Check the image, write it atomically, upsert the row, then drop a replaced file of the other
    extension. Order (spec section 11.2): `.partial-<hex>`, replace, row."""
    ext = check_image(data)
    rows.get_cloud(handle, subject.cloud_id)
    folder = views_dir(handle, subject.cloud_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{subject.kind}-{subject.id}.{ext}"
    rel = f"pointclouds/{subject.cloud_id}/views/{name}"
    partial = folder / f"{PARTIAL}{uuid.uuid4().hex}"
    target = folder / name
    attempts = 5
    try:
        with open(partial, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        for attempt in range(attempts):
            try:
                os.replace(partial, target)
                break
            except PermissionError:
                # the target can be briefly open for a concurrent GET, R's report job, or the
                # indexer/Defender on Windows; retry before giving up.
                if attempt == attempts - 1:
                    raise
                time.sleep(0.1 * (attempt + 1))
    finally:
        partial.unlink(missing_ok=True)
    is_new = False
    try:
        with handle.session() as s:
            row = s.execute(select(CloudView).where(_column(subject.kind) == subject.id)).scalar_one_or_none()
            old = row.path if row is not None else None
            is_new = row is None
            if row is None:
                row = CloudView(point_cloud_id=subject.cloud_id)
                if subject.kind == "finding":
                    row.finding_id = subject.id
                else:
                    row.cloud_measurement_id = subject.id
                s.add(row)
            row.anchor_normal = meta.anchor_normal
            row.pose = meta.pose.model_dump()
            row.render = meta.render.model_dump()
            row.path = rel
            row.sha256 = hashlib.sha256(data).hexdigest()
            row.bytes = len(data)
            row.width, row.height = WIDTH, HEIGHT
            row.anchor_hash = subject.anchor_hash
            row.captured_at = utcnow()
            s.flush()
            out = _out(row, subject.anchor_hash)
    except IntegrityError:
        # the subject (finding/measurement) was deleted between resolving it and this upsert.
        if is_new:
            _unlink(target)
        raise not_found(subject.kind, subject.id) from None
    if old and old != rel:
        _unlink(handle.folder / old)
    return out


# ------------------------------------------------------------------ read


def stored_view(handle: ProjectHandle, subject_kind: str, subject_id: str) -> StoredView | None:
    """The subject's view with its file, or None when there is no row or no file (reports spec 9.4)."""
    if subject_kind not in ("finding", "cloud_measurement"):
        raise ValueError(f"subject_kind must be 'finding' or 'cloud_measurement', not {subject_kind!r}")
    with handle.session() as s:
        row = s.execute(select(CloudView).where(_column(subject_kind) == subject_id)).scalar_one_or_none()
        if row is None:
            return None
        meta = _out(row, _current_hash(s, row))
        path = handle.folder / row.path
    if not path.is_file():
        return None
    return StoredView(meta, path, MEDIA[path.suffix.lstrip(".")])


def read_image(handle: ProjectHandle, subject_kind: str, subject_id: str) -> tuple[bytes, str, str]:
    """(bytes, media type, sha256) of the view (at most 6 MiB), or 404 `no_view`."""
    view = stored_view(handle, subject_kind, subject_id)
    missing = AppError("no_view", "no 3D view is saved for this; open it in Point clouds to capture one", 404)
    if view is None:
        raise missing
    try:
        data = view.path.read_bytes()
    except OSError as e:
        raise missing from e
    return data, view.media_type, view.meta.sha256


def list_for_cloud(handle: ProjectHandle, cloud_id: str) -> list[CloudViewOut]:
    """Every view's metadata in the cloud (at most MAX_LISTED, no bytes), then the list sweep."""
    rows.get_cloud(handle, cloud_id)
    with handle.session() as s:
        found = s.execute(
            select(CloudView, Finding.x, Finding.y, Finding.z, CloudMeasurement.points)
            .outerjoin(Finding, CloudView.finding_id == Finding.id)
            .outerjoin(CloudMeasurement, CloudView.cloud_measurement_id == CloudMeasurement.id)
            .where(CloudView.point_cloud_id == cloud_id)
            .order_by(CloudView.captured_at, CloudView.id)
            .limit(MAX_LISTED)
        ).all()
        items = [
            _out(v, finding_hash(x, y, z) if v.finding_id else measurement_hash(points))
            for v, x, y, z, points in found
        ]
        keep = set(s.execute(select(CloudView.path).where(CloudView.point_cloud_id == cloud_id)).scalars())
    try:
        sweep_cloud(handle, cloud_id, keep)
    except Exception:
        log.exception("could not sweep the report views of point cloud %s", cloud_id)
    return items


def measurement_views(handle: ProjectHandle, cloud_id: str) -> dict[str, CloudViewOut]:
    """measurement id -> its view, for the measurement list (at most 1 000 rows)."""
    with handle.session() as s:
        found = s.execute(
            select(CloudView, CloudMeasurement.points)
            .join(CloudMeasurement, CloudView.cloud_measurement_id == CloudMeasurement.id)
            .where(CloudView.point_cloud_id == cloud_id)
        ).all()
        return {v.cloud_measurement_id: _out(v, measurement_hash(points)) for v, points in found}


def measurement_view(handle: ProjectHandle, measurement_id: str) -> CloudViewOut | None:
    with handle.session() as s:
        row = s.execute(
            select(CloudView).where(CloudView.cloud_measurement_id == measurement_id)
        ).scalar_one_or_none()
        return _out(row, _current_hash(s, row)) if row is not None else None


# ------------------------------------------------------------------ remove and sweep


def remove_files(handle: ProjectHandle, cloud_id: str, subject_kind: str, subject_id: str) -> None:
    """The subject's view file, whichever extension (C's measurement delete calls this)."""
    for ext in ("png", "jpg"):
        _unlink(views_dir(handle, cloud_id) / f"{subject_kind}-{subject_id}.{ext}")


def sweep_cloud(
    handle: ProjectHandle, cloud_id: str, keep: set[str] | None, *, partials: bool = False
) -> int:
    """Remove view files with no row (`keep` holds the rows' paths; None = rows unknown, skip them)
    and, with `partials`, `.partial-*` files. Files younger than SWEEP_GRACE_S are always spared, and
    a file that is neither a view nor a partial is never touched. Returns the number removed."""
    folder = views_dir(handle, cloud_id)
    if not folder.is_dir():
        return 0
    now = time.time()
    removed = 0
    for f in list(folder.iterdir()):
        try:
            if f.name.startswith(PARTIAL):
                if not partials:
                    continue
            elif keep is None or not VIEW_FILE.match(f.name):
                continue
            elif f"pointclouds/{cloud_id}/views/{f.name}" in keep:
                continue
            if now - f.stat().st_mtime < SWEEP_GRACE_S:
                continue
            f.unlink()
            removed += 1
        except FileNotFoundError:
            continue  # a concurrent replace removed it first; nothing to warn about
        except OSError:
            log.warning("could not sweep the report view %s", f, exc_info=True)
    return removed


def sweep_all(handle: ProjectHandle) -> int:
    """The startup step (spec section 11.2): every cloud's `.partial-*` files and orphan views. The
    folders are listed before the rows are read; without rows only the partials go."""
    base = handle.pointclouds_dir
    try:
        clouds = [d.name for d in base.iterdir() if (d / "views").is_dir()] if base.is_dir() else []
    except OSError:
        log.exception("could not list the point-cloud folders in %s", base)
        return 0
    keep: set[str] | None
    try:
        with handle.session() as s:
            keep = set(s.execute(select(CloudView.path)).scalars())
    except Exception:
        log.exception("could not read the report views of project %s; sweeping partial files only", handle.id)
        keep = None
    removed = 0
    for cloud_id in clouds:
        try:
            removed += sweep_cloud(handle, cloud_id, keep, partials=True)
        except Exception:
            log.exception("could not sweep the report views of point cloud %s", cloud_id)
    if removed:
        log.info("removed %d orphan report-view file(s) in project %s", removed, handle.id)
    return removed
