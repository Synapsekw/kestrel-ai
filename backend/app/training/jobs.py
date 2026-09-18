"""The `train` and `export` job functions (spec section 7). Registered with the S0 job runner."""

import shutil
from pathlib import Path

from app.errors import AppError
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.projects.service import ProjectHandle
from app.training import registry
from app.training.presets import TrainParams
from app.training.trainer import get_trainer

# ONNX exports fine on the CPU; TensorRT engines have to be built on the GPU they run on.
EXPORT_DEVICE = {"onnx": "cpu", "engine": "0"}


def data_yaml_path(handle: ProjectHandle, dataset) -> Path:
    return handle.folder / dataset.path / "data.yaml"


def check_materialised(handle: ProjectHandle, dataset) -> Path:
    """S1's materialise job writes data.yaml; training cannot start before it exists."""
    path = data_yaml_path(handle, dataset)
    if not path.is_file():
        raise AppError(
            "validation_error",
            f"dataset {dataset.name!r} has no data.yaml at {dataset.path}; materialise it first",
            422,
        )
    return path


@register_job_type("train")
def run_train(ctx: JobContext) -> dict:
    handle, p = ctx.project, ctx.params
    base_model = registry.get_model(handle, p["base_model_id"])
    dataset = registry.get_dataset(handle, p["dataset_id"])
    params = TrainParams(
        data_yaml=str(check_materialised(handle, dataset)),
        base_weights=str(handle.folder / base_model.weights_path),
        run_dir=str(handle.runs_dir / ctx.job_id),
        epochs=int(p.get("epochs", 50)),
        imgsz=int(p.get("imgsz", 1280)),
        batch=p.get("batch"),
        patience=int(p.get("patience", 50)),
        augmentation=p.get("augmentation", "default"),
        device=p.get("device", "0"),
    )
    ctx.log.info("training %s on dataset %s for %s epochs", p["name"], dataset.name, params.epochs)
    result = get_trainer().train(params, ctx.progress, ctx.cancelled, ctx.log)
    ctx.check_cancelled()
    model = registry.register_trained(
        handle,
        name=p["name"],
        base_model=base_model,
        dataset=dataset,
        params=params,
        result=result,
        job_id=ctx.job_id,
    )
    ctx.log.info("registered model %s (%s)", model.id, model.weights_path)
    return {"model_id": model.id, "metrics": model.metrics}


@register_job_type("export")
def run_export(ctx: JobContext) -> dict:
    handle, p = ctx.project, ctx.params
    model = registry.get_model(handle, p["model_id"])
    fmt = p["format"]
    exported = get_trainer().export(
        handle.folder / model.weights_path,
        fmt,
        int(p.get("imgsz", 1280)),
        bool(p.get("half", False)),
        EXPORT_DEVICE.get(fmt, "0"),
        handle.runs_dir / ctx.job_id,
        ctx.cancelled,
        ctx.log,
    )
    ctx.check_cancelled()
    target = handle.models_dir / f"{Path(model.weights_path).stem}.{fmt}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if Path(exported).resolve() != target.resolve():
        shutil.move(str(exported), str(target))
    row = registry.set_export(handle, model.id, fmt, target)
    ctx.log.info("exported %s to %s", model.id, row.exports[fmt])
    return {"format": fmt, "path": row.exports[fmt]}
