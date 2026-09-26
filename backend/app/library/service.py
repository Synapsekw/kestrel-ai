"""Library models: add, list, edit, delete, and where their files are (spec section 4).

Every model has its own folder, `models/<slug>-<id8>/`, holding `weights.pt`, `exports/` and
`artifacts/`. `weights_path` is relative to the library root; `exports` and `artifacts` are
relative to the model's folder, as the contract describes them. Reading a checkpoint is the one
operation that needs ultralytics, and it imports lazily.
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
import statistics
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import func, select, tuple_
from sqlalchemy.exc import IntegrityError

from app.db.base import new_id
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.library.db import LibraryModel
from app.library.gsd import (
    EXIF_SAMPLE,
    image_gsd_cm,
    intrinsics_from_exif,
    model_gsd_cm,
    plausible,
)
from app.library.handle import LIBRARY_UNAVAILABLE, LibraryHandle
from app.pagination import clamp_limit, decode_cursor, encode_cursor

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle, ProjectRegistry

log = logging.getLogger(__name__)

HASH_CHUNK = 1024 * 1024
EDITABLE = {"name", "notes", "supplier", "class_aliases", "train_gsd_cm"}

#: The review states that count as the dataset's labels, exactly as `datasets/materialise.py` reads
#: them when it builds the training set. The cross-check must measure what the model was trained on,
#: not the suggestions a curator rejected.
GROUND_TRUTH = ("accepted", "edited")


def slug(name: str) -> str:
    """A file-safe stem for a model folder."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "model"


def sha256_file(path: Path) -> str:
    """Streamed in chunks: weights files run to hundreds of megabytes."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(HASH_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def read_checkpoint(weights: Path) -> tuple[str, list[str]]:
    """`(task, class_names)` of a YOLO checkpoint, class names in index order (lazy ultralytics)."""
    from ultralytics import YOLO

    model = YOLO(str(weights))
    names = model.names or {}
    if isinstance(names, dict):
        class_names = [str(names[k]) for k in sorted(names, key=lambda k: int(k))]
    else:
        class_names = [str(n) for n in names]
    return str(model.task), class_names


def _detached(s, row: LibraryModel) -> LibraryModel:
    s.flush()
    s.expunge(row)
    return row


def find_by_sha(lib: LibraryHandle, sha256: str) -> LibraryModel | None:
    with lib.session() as s:
        row = s.execute(select(LibraryModel).where(LibraryModel.sha256 == sha256)).scalar_one_or_none()
        if row is not None:
            s.expunge(row)
        return row


def _already(existing: LibraryModel) -> AppError:
    return AppError(
        "already_exists",
        f"This weights file is already in the library as {existing.name}.",
        409,
        {"model_id": existing.id},
    )


def _copy_into(folder: Path, sub: str, files: dict[str, Path] | None) -> dict[str, str]:
    """Copy each existing file to `<folder>/<sub>/<name>`; values are relative to `folder`, posix."""
    out: dict[str, str] = {}
    for key, src in (files or {}).items():
        src = Path(src)
        if not src.is_file():
            continue
        target = folder / sub / src.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        out[key] = target.relative_to(folder).as_posix()
    return out


def add_model(
    lib: LibraryHandle,
    *,
    source_weights: Path,
    name: str,
    origin: str,
    task: str,
    class_names: list[str],
    class_aliases: dict | None = None,
    provenance: dict | None = None,
    metrics: dict | None = None,
    hyperparameters: dict | None = None,
    artifacts: dict[str, Path] | None = None,
    exports: dict[str, Path] | None = None,
    supplier: str | None = None,
    train_gsd_cm: float | None = None,
    sha256: str | None = None,
) -> LibraryModel:
    """Copy the weights (and artifacts/exports) into a new model folder and register the row.

    The source files are only read. A file whose sha256 is already in the library is refused with
    409 `already_exists` naming the existing model, and nothing is left behind.
    """
    source = Path(source_weights)
    digest = sha256 or sha256_file(source)
    existing = find_by_sha(lib, digest)
    if existing is not None:
        raise _already(existing)
    model_id = new_id()
    folder = lib.models_dir / f"{slug(name)}-{model_id[:8]}"
    suffix = source.suffix.lower() or ".pt"
    target = folder / f"weights{suffix}"
    try:
        folder.mkdir(parents=True, exist_ok=False)
        shutil.copy2(source, target)
        row = LibraryModel(
            id=model_id,
            name=name,
            notes="",
            supplier=supplier,
            task=task,
            format=suffix.lstrip("."),
            origin=origin,
            weights_path=target.relative_to(lib.folder).as_posix(),
            class_names=list(class_names or []),
            class_aliases=dict(class_aliases or {}),
            provenance=dict(provenance or {}),
            hyperparameters=dict(hyperparameters or {}),
            metrics=metrics or None,
            exports=_copy_into(folder, "exports", exports),
            artifacts=_copy_into(folder, "artifacts", artifacts),
            train_gsd_cm=train_gsd_cm,
            sha256=digest,
        )
        with lib.session() as s:
            s.add(row)
            return _detached(s, row)
    except IntegrityError:
        # Two adds of the same file raced past the lookup; the unique index kept one of them.
        shutil.rmtree(folder, ignore_errors=True)
        existing = find_by_sha(lib, digest)
        if existing is None:
            raise
        raise _already(existing) from None
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise


def list_models(
    lib: LibraryHandle, limit: int | None, cursor: str | None, task: str | None = None
) -> tuple[list[LibraryModel], str | None]:
    n = clamp_limit(limit)
    q = select(LibraryModel).order_by(LibraryModel.created_at.desc(), LibraryModel.id.desc())
    if task:
        q = q.where(LibraryModel.task == task)
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        try:
            after = datetime.fromisoformat(str(c["created_at"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(tuple_(LibraryModel.created_at, LibraryModel.id) < (after, str(c["id"])))
    with lib.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
    return rows, next_cursor


def get_model(lib: LibraryHandle, model_id: str) -> LibraryModel:
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        s.expunge(row)
        return row


def update_model(lib: LibraryHandle, model_id: str, **fields) -> LibraryModel:
    """Rename, or change notes, supplier, class aliases or training scale.

    Anything else is a programming error.
    """
    unknown = set(fields) - EDITABLE
    if unknown:
        raise ValueError(f"not editable: {sorted(unknown)}")
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        for k, v in fields.items():
            setattr(row, k, dict(v) if k == "class_aliases" else v)
        return _detached(s, row)


def weights_file(lib: LibraryHandle, row: LibraryModel) -> Path:
    return lib.folder / row.weights_path


def model_dir(lib: LibraryHandle, row: LibraryModel) -> Path:
    return weights_file(lib, row).parent


def delete_model(lib: LibraryHandle, model_id: str) -> None:
    """Drop the row and the model's own folder. Nothing outside `models/<that folder>` is touched."""
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        folder = model_dir(lib, row)
        s.delete(row)
    models = lib.models_dir.resolve()
    if folder.resolve().parent == models and folder.resolve() != models:
        shutil.rmtree(folder, ignore_errors=True)
    else:
        log.warning("model %s points outside the library models folder; its files were kept", model_id)


def state_of(lib: LibraryHandle, row: LibraryModel) -> str:
    return "ready" if weights_file(lib, row).is_file() else "unavailable"


def require_ready(lib: LibraryHandle, model_id: str) -> LibraryModel:
    """The model, or 404 when unknown and 409 `model_unavailable` when its weights file is gone."""
    row = get_model(lib, model_id)
    if state_of(lib, row) != "ready":
        raise AppError(
            "model_unavailable",
            f"The weights file of {row.name} is missing from the library folder.",
            409,
            {"model_id": row.id},
        )
    return row


def model_for_job(lib: LibraryHandle | None, model_id: str) -> tuple[LibraryHandle, LibraryModel]:
    """A job's library model, with the operator-facing reason as a JobFailure when it cannot run."""
    if lib is None:
        raise JobFailure(LIBRARY_UNAVAILABLE)
    try:
        return lib, require_ready(lib, model_id)
    except AppError as e:
        if e.status == 404:
            raise JobFailure("The model this run uses is no longer in the library.") from e
        raise JobFailure(e.message) from e


def set_export(lib: LibraryHandle, model_id: str, fmt: str, path: Path) -> LibraryModel:
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        rel = Path(path).resolve().relative_to(model_dir(lib, row).resolve()).as_posix()
        row.exports = {**(row.exports or {}), fmt: rel}
        return _detached(s, row)


def usage(lib: LibraryHandle, registry: ProjectRegistry, model_id: str) -> list[dict]:
    """Recent projects that use the model: pre-annotation, detection runs and map runs.

    Only the recent-projects list is scanned (at most 20 projects), with one COUNT per table per
    project. A project that fails to open is skipped with a log line.
    """
    from app.db.models import MapRun, QueryRun

    get_model(lib, model_id)
    out = []
    for recent in registry.recent():
        folder = Path(recent["folder"])
        if not (folder / "project.db").is_file():
            continue
        try:
            handle = registry.open(folder, remember=False)
            with handle.session() as s:
                project = handle.row(s)
                query_runs = s.execute(
                    select(func.count()).select_from(QueryRun).where(QueryRun.model_id == model_id)
                ).scalar_one()
                map_runs = s.execute(
                    select(func.count()).select_from(MapRun).where(MapRun.model_id == model_id)
                ).scalar_one()
                preannotation = project.preannotation_model_id == model_id
                entry = {
                    "project_id": project.id,
                    "name": project.name,
                    "folder": str(handle.folder),
                    "preannotation": preannotation,
                    "query_runs": int(query_runs),
                    "map_runs": int(map_runs),
                }
        except Exception:
            log.exception("could not scan project at %s for uses of model %s", folder, model_id)
            continue
        if preannotation or query_runs or map_runs:
            out.append(entry)
    return out


# ------------------------------------------------- the scale a model was trained at (spec 2026-09-23)


@dataclass(frozen=True)
class GsdEstimate:
    train_gsd_cm: float
    image_gsd_cm: float
    median_alt_m: float
    focal_mm: float
    sensor_width_mm: float
    sensor_source: str
    sample_size: int
    imgsz: int
    median_object_m: float
    per_class_m: dict[str, float]
    plausible: bool


def estimate_train_gsd(registry: ProjectRegistry, model: LibraryModel) -> GsdEstimate | None:
    """The scale `model` was trained at, derived from the dataset it was trained on (spec section 3).

    The library is app-wide, so the dataset lives in another database: the model's `provenance`
    snapshot names the originating project folder and dataset id, and the project is opened the same
    way `usage()` opens it. A model with no usable provenance simply has no estimate - there is
    nothing to measure, and inventing a fallback would be inventing the answer.
    """
    provenance = model.provenance or {}
    folder = provenance.get("project_folder")
    dataset_id = provenance.get("dataset_id")
    imgsz = int((model.hyperparameters or {}).get("imgsz") or 0)
    if not folder or not dataset_id or imgsz <= 0:
        return None
    try:
        handle = registry.open(Path(str(folder)), remember=False)
    except Exception:
        log.info("model %s names a project folder that cannot be opened: %s", model.id, folder)
        return None
    return estimate_for_dataset(handle, str(dataset_id), imgsz)


def estimate_for_dataset(handle: ProjectHandle, dataset_id: str, imgsz: int) -> GsdEstimate | None:
    """The derivation itself, against an open project (spec section 3).

    Altitude is already on every image row, so the expensive input costs no file I/O. Only the
    camera intrinsics need EXIF, and those are a property of the camera: at most EXIF_SAMPLE
    headers are opened, however large the dataset. That is what keeps this a bounded read and a
    plain request rather than a background job.
    """
    from PIL import Image as PILImage

    from app.db.models import Box, Dataset, DatasetImage, Image

    if imgsz <= 0:
        return None

    with handle.session() as s:
        dataset = s.get(Dataset, dataset_id)
        if dataset is None:
            return None
        rows = list(
            s.execute(
                select(Image.path, Image.width, Image.height, Image.alt)
                .join(DatasetImage, DatasetImage.image_id == Image.id)
                .where(DatasetImage.dataset_id == dataset_id)
            )
        )
        names = {str(c.get("id")): str(c.get("name")) for c in (dataset.classes or [])}
        # Ground truth only, and only classes the dataset still has: `materialise.py` filters both
        # ways when it writes the labels, so anything else is measuring boxes the model never saw.
        sizes = list(
            s.execute(
                select(Box.class_id, func.avg(Box.w), func.count())
                .join(DatasetImage, DatasetImage.image_id == Box.image_id)
                .where(
                    DatasetImage.dataset_id == dataset_id,
                    Box.review_state.in_(GROUND_TRUTH),
                    Box.class_id.in_(list(names)),
                )
                .group_by(Box.class_id)
            )
        )

    alts = [r.alt for r in rows if r.alt is not None]
    if not alts or not rows:
        return None
    median_alt = statistics.median(alts)

    intr = None
    read = 0
    for r in rows[:EXIF_SAMPLE]:
        try:
            with PILImage.open(handle.folder / r.path) as im:
                read += 1
                intr = intrinsics_from_exif(im.getexif())
        except OSError:
            continue
        if intr:
            break
    if intr is None:
        return None

    stored_w = rows[0].width
    stored_h = rows[0].height
    # The long side, not the width: import applies `ImageOps.exif_transpose`, so a frame shot at
    # orientation 6/8 is *stored* portrait while the EXIF copied with it still reports the sensor's
    # long axis. Dividing the ground width by the stored width would then no longer cancel against
    # the letterbox below, and the estimate would come out 1.5x too large.
    img_gsd = image_gsd_cm(median_alt, intr, max(stored_w, stored_h))
    train_gsd = model_gsd_cm(img_gsd, stored_w, stored_h, imgsz)

    per_class = {
        names[str(cid)]: round(float(avg_w) * img_gsd / 100.0, 2) for cid, avg_w, _n in sizes if avg_w
    }
    median_object = statistics.median(per_class.values()) if per_class else 0.0

    return GsdEstimate(
        train_gsd_cm=round(train_gsd, 2),
        image_gsd_cm=round(img_gsd, 3),
        median_alt_m=round(median_alt, 2),
        focal_mm=round(intr.focal_mm, 2),
        sensor_width_mm=round(intr.sensor_width_mm, 3),
        sensor_source=intr.source,
        sample_size=read,
        imgsz=imgsz,
        median_object_m=round(median_object, 2),
        per_class_m=per_class,
        plausible=bool(per_class) and plausible(median_object),
    )
