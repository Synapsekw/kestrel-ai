"""The `train` job (spec section 7): trains in a training project and registers the result in the
model library (spec 2026-09-23 section 4.3). Registered with the S0 job runner."""

from dataclasses import asdict
from pathlib import Path

import yaml

from app.db.models import Dataset
from app.errors import AppError, not_found
from app.jobs.cancellation import JobFailure
from app.jobs.gpu import hold_gpu
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library import service as library
from app.projects.service import ProjectHandle
from app.training.presets import TrainParams
from app.training.trainer import get_trainer

# Paths that are only meaningful inside this run; they are not kept as the model's hyperparameters.
PATH_PARAMS = ("data_yaml", "base_weights", "run_dir")
LIBRARY_GONE = "The model library is not available, so training cannot start. Restart the app."


def get_dataset(handle: ProjectHandle, dataset_id: str) -> Dataset:
    with handle.session() as s:
        row = s.get(Dataset, dataset_id)
        if row is None:
            raise not_found("dataset", dataset_id)
        s.expunge(row)
        return row


def data_yaml_path(handle: ProjectHandle, dataset) -> Path:
    return handle.folder / dataset.path / "data.yaml"


def yaml_class_names(data_yaml: Path) -> list[str]:
    """`names` from a YOLO data.yaml, in class-index order (a mapping or a plain list)."""
    names = (yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}).get("names") or {}
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=lambda k: int(k))]
    return [str(n) for n in names]


def check_materialised(handle: ProjectHandle, dataset) -> Path:
    """S1's materialise job writes data.yaml; training cannot start before it exists.

    The class snapshot on the Dataset row is what the trained model is registered with, so it has to
    agree with the file the trainer reads: a drifted data.yaml would label the classes wrongly.
    """
    path = data_yaml_path(handle, dataset)
    if not path.is_file():
        raise AppError(
            "validation_error",
            f"dataset {dataset.name!r} has no data.yaml at {dataset.path}; materialise it first",
            422,
        )
    snapshot = [str(c.get("name")) for c in (dataset.classes or [])]
    in_file = yaml_class_names(path)
    if snapshot != in_file:
        raise AppError(
            "validation_error",
            f"dataset {dataset.name!r} lists classes {snapshot} but {dataset.path}/data.yaml has "
            f"{in_file}; re-materialise the dataset",
            422,
        )
    return path


@register_job_type("train")
def run_train(ctx: JobContext) -> dict:
    handle, p = ctx.project, ctx.params
    lib = ctx.runner.library
    if lib is None:
        raise JobFailure(LIBRARY_GONE)
    try:
        base_model = library.require_ready(lib, p["base_model_id"])
    except AppError as e:
        raise JobFailure(e.message) from e
    dataset = get_dataset(handle, p["dataset_id"])
    params = TrainParams(
        data_yaml=str(check_materialised(handle, dataset)),
        base_weights=str(library.weights_file(lib, base_model)),
        run_dir=str(handle.runs_dir / ctx.job_id),
        epochs=int(p.get("epochs", 50)),
        imgsz=int(p.get("imgsz", 1280)),
        batch=p.get("batch"),
        patience=int(p.get("patience", 50)),
        augmentation=p.get("augmentation", "default"),
        device=p.get("device", "0"),
    )
    ctx.log.info("training %s on dataset %s for %s epochs", p["name"], dataset.name, params.epochs)
    with hold_gpu(ctx.log, "train", cancelled=ctx.cancelled):
        result = get_trainer().train(params, ctx.progress, ctx.cancelled, ctx.log)
    ctx.check_cancelled()
    with handle.session() as s:
        project = handle.row(s)
        project_name = project.name
    artifacts = {
        "results_csv": result.results_csv,
        "confusion_matrix": result.confusion_matrix,
        "pr_curve": result.pr_curve,
    }
    try:
        model = library.add_model(
            lib,
            source_weights=Path(result.best_weights),
            name=p["name"],
            origin="trained",
            # Datasets record no task yet: every dataset is axis-aligned boxes. An OBB dataset
            # would register an `obb` model here.
            task=getattr(dataset, "task", None) or "detect",
            class_names=[str(c.get("name")) for c in (dataset.classes or [])],
            metrics=result.final_metrics or None,
            hyperparameters={k: v for k, v in asdict(params).items() if k not in PATH_PARAMS},
            artifacts={k: Path(v) for k, v in artifacts.items() if v is not None},
            provenance={
                "project_id": handle.id,
                "project_name": project_name,
                "project_folder": str(handle.folder),
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "run_id": ctx.job_id,
                "base_model_id": base_model.id,
                "base_model_name": base_model.name,
            },
        )
    except AppError as e:  # the run produced weights identical to a library model
        raise JobFailure(e.message) from e
    ctx.log.info("registered library model %s (%s)", model.id, model.weights_path)
    return {"model_id": model.id, "metrics": model.metrics}
