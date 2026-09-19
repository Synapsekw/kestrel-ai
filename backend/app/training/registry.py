"""Model registry: imported and trained weights with their metrics and run artifacts (spec section 7).

Reading class names is the one operation here that needs ultralytics; it imports lazily so the
API process only pays for torch when a user imports weights.
"""

import re
import shutil
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, tuple_

from app.db.models import Dataset, Model
from app.errors import AppError, not_found
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle
from app.training.presets import TrainParams
from app.training.trainer import TrainResult

PATH_PARAMS = ("data_yaml", "base_weights", "run_dir")


def slug(name: str) -> str:
    """A file-safe stem for weights copied into the project."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "model"


def read_class_names(weights: Path) -> list[str]:
    """Class names in index order, read from the checkpoint once (lazy ultralytics import)."""
    from ultralytics import YOLO

    names = YOLO(str(weights)).names or {}
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


def import_model(handle: ProjectHandle, name: str, weights_path: str, class_aliases: dict) -> Model:
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
        class_names = read_class_names(target)
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
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        s.expunge(row)
    return row
