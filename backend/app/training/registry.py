"""Model registry: imported and trained weights with their metrics and run artifacts (spec section 7).

Reading class names is the one operation here that needs ultralytics; it imports lazily so the
API process only pays for torch when a user imports weights.
"""

import logging
import re
import shutil
import statistics
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage
from sqlalchemy import func, select, tuple_

from app.db.models import Box, Dataset, DatasetImage, Image, Model
from app.errors import AppError, not_found
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle
from app.training.gsd import (
    EXIF_SAMPLE,
    image_gsd_cm,
    intrinsics_from_exif,
    model_gsd_cm,
    plausible,
)
from app.training.presets import TrainParams
from app.training.trainer import TrainResult

PATH_PARAMS = ("data_yaml", "base_weights", "run_dir")

log = logging.getLogger(__name__)


def slug(name: str) -> str:
    """A file-safe stem for weights copied into the project."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "model"


def read_class_names(weights: Path, *, expected_task: str | None = None) -> list[str]:
    """Class names in index order, read from the checkpoint once (lazy ultralytics import)."""
    from ultralytics import YOLO

    model = YOLO(str(weights))
    if expected_task is not None and model.task != expected_task:
        raise ValueError(f"This starter requires a {expected_task} checkpoint; found {model.task!r}.")
    names = model.names or {}
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=lambda k: int(k))]
    return [str(n) for n in names]


def relative(handle: ProjectHandle, path: Path) -> str:
    """A project-relative path with forward slashes, as the contract stores it."""
    p = Path(path)
    try:
        return p.resolve().relative_to(handle.folder.resolve()).as_posix()
    except ValueError:
        return p.as_posix()


def import_model(
    handle: ProjectHandle,
    name: str,
    weights_path: str,
    class_aliases: dict,
    *,
    expected_task: str | None = None,
) -> Model:
    source = Path(weights_path)
    # An empty weights_path is a 422 from the schema (`minLength: 1`). Anything else that is
    # schema-valid but unusable answers 404: the contract's conformance gate (schemathesis
    # positive_data_acceptance) rejects a 422 on a schema-compliant body, and no schema can express
    # "this file exists". See the fix report for the one-line options to make this a 422 instead.
    if not source.is_absolute() or source.suffix.lower() != ".pt" or not source.is_file():
        raise AppError(
            "not_found",
            f"no usable weights at {weights_path}: an absolute path to an existing .pt file is required",
            404,
        )

    handle.models_dir.mkdir(parents=True, exist_ok=True)
    target = handle.models_dir / f"{slug(name)}-{uuid.uuid4().hex[:8]}.pt"
    shutil.copy2(source, target)  # the source stays where it is: it may be a read-only input
    try:
        class_names = (
            read_class_names(target, expected_task=expected_task)
            if expected_task is not None
            else read_class_names(target)
        )
    except Exception as e:
        target.unlink(missing_ok=True)  # never leave a half-imported copy in the project
        raise AppError(
            "validation_error", f"{weights_path} is not a loadable YOLO checkpoint: {e}", 422
        ) from e
    row = Model(
        name=name,
        kind="imported",
        weights_path=relative(handle, target),
        hyperparameters={},
        metrics=None,
        class_names=class_names,
        class_aliases=dict(class_aliases or {}),
        exports={},
        artifacts={},
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def list_models(
    handle: ProjectHandle, limit: int | None, cursor: str | None
) -> tuple[list[Model], str | None]:
    n = clamp_limit(limit)
    q = select(Model).order_by(Model.created_at.desc(), Model.id.desc())
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        try:
            after = datetime.fromisoformat(str(c["created_at"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(tuple_(Model.created_at, Model.id) < (after, str(c["id"])))
    with handle.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
    return rows, next_cursor


def get_model(handle: ProjectHandle, model_id: str) -> Model:
    with handle.session() as s:
        row = s.get(Model, model_id)
        if row is None:
            raise not_found("model", model_id)
        s.expunge(row)
        return row


def get_dataset(handle: ProjectHandle, dataset_id: str) -> Dataset:
    with handle.session() as s:
        row = s.get(Dataset, dataset_id)
        if row is None:
            raise not_found("dataset", dataset_id)
        s.expunge(row)
        return row


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


def estimate_train_gsd(handle: ProjectHandle, model: Model) -> GsdEstimate | None:
    """The scale `model` was trained at, derived from its dataset (spec section 3).

    Altitude is already on every image row, so the expensive input costs no file I/O. Only the
    camera intrinsics need EXIF, and those are a property of the camera: at most EXIF_SAMPLE
    headers are opened, however large the dataset.
    """
    if not model.dataset_id:
        return None
    imgsz = int((model.hyperparameters or {}).get("imgsz") or 0)
    if imgsz <= 0:
        return None

    with handle.session() as s:
        dataset = s.get(Dataset, model.dataset_id)
        if dataset is None:
            return None
        rows = list(
            s.execute(
                select(Image.path, Image.width, Image.height, Image.alt)
                .join(DatasetImage, DatasetImage.image_id == Image.id)
                .where(DatasetImage.dataset_id == model.dataset_id)
            )
        )
        sizes = list(
            s.execute(
                select(Box.class_id, func.avg(Box.w), func.count())
                .join(DatasetImage, DatasetImage.image_id == Box.image_id)
                .where(DatasetImage.dataset_id == model.dataset_id)
                .group_by(Box.class_id)
            )
        )
        names = {str(c.get("id")): str(c.get("name")) for c in (dataset.classes or [])}

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
    img_gsd = image_gsd_cm(median_alt, intr, stored_w)
    train_gsd = model_gsd_cm(img_gsd, stored_w, stored_h, imgsz)

    per_class = {
        names.get(str(cid), str(cid)): round(float(avg_w) * img_gsd / 100.0, 2)
        for cid, avg_w, _n in sizes
        if avg_w
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


def set_train_gsd(handle: ProjectHandle, model_id: str, value: float | None) -> Model:
    with handle.session() as s:
        row = s.get(Model, model_id)
        if row is None:
            raise not_found("model", model_id)
        row.train_gsd_cm = value
        s.flush()
        s.expunge(row)
    return row


def delete_model(handle: ProjectHandle, model_id: str) -> None:
    """Drop the row, the weights and every export file. Boxes keep their model_id provenance."""
    with handle.session() as s:
        row = s.get(Model, model_id)
        if row is None:
            raise not_found("model", model_id)
        files = [row.weights_path, *(row.exports or {}).values()]
        s.delete(row)
    for rel in files:
        if rel:
            (handle.folder / rel).unlink(missing_ok=True)


def set_export(handle: ProjectHandle, model_id: str, fmt: str, path: Path) -> Model:
    with handle.session() as s:
        row = s.get(Model, model_id)
        if row is None:
            raise not_found("model", model_id)
        row.exports = {**(row.exports or {}), fmt: relative(handle, path)}
        s.flush()
        s.expunge(row)
        return row


def register_trained(
    handle: ProjectHandle,
    *,
    name: str,
    base_model: Model,
    dataset: Dataset,
    params: TrainParams,
    result: TrainResult,
    job_id: str,
) -> Model:
    """Register a finished run: copy best.pt into the project and keep metrics and artifacts."""
    handle.models_dir.mkdir(parents=True, exist_ok=True)
    target = handle.models_dir / f"{slug(name)}-{job_id[:8]}.pt"
    shutil.copy2(result.best_weights, target)
    artifacts = {
        "results_csv": result.results_csv,
        "confusion_matrix": result.confusion_matrix,
        "pr_curve": result.pr_curve,
    }
    row = Model(
        name=name,
        kind="trained",
        weights_path=relative(handle, target),
        base_weights=base_model.weights_path,
        dataset_id=dataset.id,
        hyperparameters={k: v for k, v in asdict(params).items() if k not in PATH_PARAMS},
        metrics=result.final_metrics or None,
        class_names=[str(c.get("name")) for c in (dataset.classes or [])],
        class_aliases={},
        exports={},
        artifacts={k: relative(handle, v) for k, v in artifacts.items() if v is not None},
        run_id=job_id,
        train_gsd_cm=None,  # set below, once the row exists to estimate from
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        s.expunge(row)
    # Best effort: a model that cannot be measured is registered anyway, and the operator is asked
    # the first time they start a run with it. Registration must never fail because the estimate
    # could not be computed.
    try:
        estimate = estimate_train_gsd(handle, row)
    except Exception:
        log.exception("gsd estimate failed for newly registered model %s", row.id)
        estimate = None
    if estimate and estimate.plausible:
        row = set_train_gsd(handle, row.id, estimate.train_gsd_cm)
    return row
