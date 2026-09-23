"""Library jobs: `library_import` and `library_export` (spec section 4.3). `library_starter` lives in
`app.training.starter_download`. They run on the shared JobRunner with the library handle as their
`ctx.project`, so their rows and logs live in the library folder."""

import shutil
from pathlib import Path

from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.gpu import hold_gpu
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library import service
from app.training.trainer import get_trainer

DETECTION_TASKS = ("detect", "obb")
# ONNX exports fine on the CPU; TensorRT engines have to be built on the GPU they run on.
EXPORT_DEVICE = {"onnx": "cpu", "engine": "0"}


def load_check(weights: Path, shown: str) -> tuple[str, list[str]]:
    """Task and class names of a copied checkpoint, as a readable JobFailure when it will not load."""
    try:
        task, names = service.read_checkpoint(weights)
    except Exception as e:
        raise JobFailure(f"{shown} is not a loadable YOLO checkpoint: {e}") from e
    if task not in DETECTION_TASKS:
        raise JobFailure(f"{shown} is a {task} model; the library holds detection models only.")
    return task, names


@register_job_type("library_import")
def run_import(ctx: JobContext) -> dict:
    """Hash, copy, load-check, register. The source file is only ever read."""
    lib, p = ctx.project, ctx.params
    source = Path(p["weights_path"])
    ctx.progress(0, f"Checking {source.name}")
    if not source.is_file():
        raise JobFailure(f"{source} no longer exists.")
    digest = service.sha256_file(source)
    existing = service.find_by_sha(lib, digest)
    if existing is not None:
        raise JobFailure(f"This file is already in the library as {existing.name}.")
    ctx.check_cancelled()
    staging = lib.runs_dir / ctx.job_id / "weights.pt"
    staging.parent.mkdir(parents=True, exist_ok=True)
    try:
        ctx.progress(0.2, f"Copying {source.name}")
        shutil.copy2(source, staging)
        ctx.progress(0.5, f"Loading {source.name}")
        task, names = load_check(staging, str(source))
        ctx.check_cancelled()
        try:
            row = service.add_model(
                lib,
                source_weights=staging,
                name=p["name"],
                origin="imported",
                task=task,
                class_names=names,
                class_aliases=p.get("class_aliases") or {},
                provenance={"source_file": str(source)},
                supplier=p.get("supplier"),
                sha256=digest,
            )
        except AppError as e:  # a concurrent import of the same file won the race
            raise JobFailure(e.message) from e
    finally:
        staging.unlink(missing_ok=True)
    ctx.progress(1, f"{row.name} is in the library")
    ctx.log.info("imported %s as library model %s", source, row.id)
    return {"model_id": row.id}


@register_job_type("library_export")
def run_export(ctx: JobContext) -> dict:
    """ONNX or TensorRT export into the model's `exports/` folder."""
    lib, p = ctx.project, ctx.params
    model = service.require_ready(lib, p["model_id"])
    fmt = p["format"]
    folder = service.model_dir(lib, model)
    weights = service.weights_file(lib, model)
    with hold_gpu(ctx.log, "export", cancelled=ctx.cancelled):
        exported = get_trainer().export(
            weights,
            fmt,
            int(p.get("imgsz", 1280)),
            bool(p.get("half", False)),
            EXPORT_DEVICE.get(fmt, "0"),
            lib.runs_dir / ctx.job_id,
            ctx.cancelled,
            ctx.log,
        )
    ctx.check_cancelled()
    exports = folder / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    target = exports / f"{weights.stem}.{fmt}"
    if Path(exported).resolve() != target.resolve():
        shutil.move(str(exported), str(target))
    row = service.set_export(lib, model.id, fmt, target)
    # A TensorRT build goes through ONNX and leaves that file next to the weights; keep it with the
    # other exports so it is not an orphan in the model folder.
    intermediate = weights.with_suffix(".onnx")
    if fmt != "onnx" and intermediate.is_file() and "onnx" not in row.exports:
        onnx = exports / intermediate.name
        shutil.move(str(intermediate), str(onnx))
        row = service.set_export(lib, model.id, "onnx", onnx)
    ctx.log.info("exported %s to %s", model.id, row.exports[fmt])
    return {"format": fmt, "path": row.exports[fmt]}
