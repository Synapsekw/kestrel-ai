"""The `train` library job (foundation F §12.2 step 4): trains a library dataset and registers the
result in the model library. It runs on the library handle, so its run folder is
`<library>/runs/<job_id>`. A built dataset whose export is not ready is exported first, inside
this same job. GPU use is unchanged: `hold_gpu` and the worker subprocess (`training/worker.py`)."""

from dataclasses import asdict
from pathlib import Path

from sqlalchemy import select

from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.gpu import hold_gpu
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library import service as library
from app.library.datasets.export import export_dataset
from app.library.datasets.service import effective_export_state, job_states
from app.library.db import LibraryDataset, LibraryDatasetSource
from app.training import runs
from app.training.presets import TrainParams
from app.training.trainer import get_trainer

# Paths that are only meaningful inside this run; they are not kept as the model's hyperparameters.
PATH_PARAMS = ("data_yaml", "base_weights", "run_dir")
#: The share of the job's progress bar an export takes when it has to run first.
EXPORT_SHARE = 0.1


def _dataset(lib, dataset_id: str) -> LibraryDataset:
    with lib.session() as s:
        row = s.get(LibraryDataset, dataset_id)
        if row is None:
            raise JobFailure("The dataset this run trains on was deleted.")
        s.expunge(row)
        return row


def _export_state(lib, dataset: LibraryDataset) -> str:
    with lib.session() as s:
        jobs = job_states(s, [dataset.export_job_id])
    return effective_export_state(lib, dataset, jobs)


def _single_project(lib, dataset: LibraryDataset) -> dict:
    """The project keys of the provenance snapshot, when the dataset came from exactly one project
    (a legacy dataset always does). A dataset across projects names none of them."""
    with lib.session() as s:
        sources = list(
            s.execute(
                select(LibraryDatasetSource).where(LibraryDatasetSource.dataset_id == dataset.id)
            ).scalars()
        )
        if len(sources) != 1:
            return {}
        src = sources[0]
        return {
            "project_id": src.project_id,
            "project_name": src.project_name,
            "project_folder": src.project_folder,
        }


def _train_gsd(ctx: JobContext, lib, registry, dataset_id: str, imgsz: int) -> float | None:
    """The scale the finished model was trained at, or None (spec 2026-09-23 section 4).

    Best effort by design: a model that cannot be measured is registered anyway and the operator is
    asked the first time they start a run with it. An implausible estimate (spec 3.3) is discarded
    rather than stored, so nothing silently defaults to an order-of-magnitude error.
    """
    try:
        estimate = library.estimate_for_library_dataset(lib, registry, dataset_id, imgsz)
    except Exception:
        ctx.log.exception("could not derive the training scale of this run")
        return None
    if estimate is None:
        ctx.log.info("the training scale of this run could not be derived; the model keeps none")
        return None
    if not estimate.plausible:
        ctx.log.info(
            "the derived training scale %.2f cm/px implies %.2f m objects, outside the plausible "
            "band; it is not stored",
            estimate.train_gsd_cm,
            estimate.median_object_m,
        )
        return None
    ctx.log.info("trained at about %.2f cm/px of ground per model pixel", estimate.train_gsd_cm)
    return estimate.train_gsd_cm


def _cancelled_before_start(ctx: JobContext) -> None:
    runs.finish(ctx.project, ctx.params["training_run_id"], "cancelled")


def _settle(ctx: JobContext, run_id: str, state: str) -> None:
    """Record how the run ended without masking the error that ended it: a failing write is
    logged, and the run then reads its state through the job row (decision 5)."""
    try:
        runs.finish(ctx.project, run_id, state)
    except Exception:
        ctx.log.exception("could not record training run %s as %s", run_id, state)


@register_job_type("train", on_cancelled_before_start=_cancelled_before_start)
def run_train(ctx: JobContext) -> dict:
    lib, run_id = ctx.project, ctx.params["training_run_id"]
    runs.mark_running(lib, run_id)
    try:
        result = _train(ctx)
    except JobCancelled:
        _settle(ctx, run_id, "cancelled")
        raise
    except BaseException:
        _settle(ctx, run_id, "failed")
        raise
    runs.finish(lib, run_id, "succeeded", model_id=result["model_id"], metrics=result["metrics"])
    return result


def _train(ctx: JobContext) -> dict:
    lib, registry, p = ctx.project, ctx.runner.projects, ctx.params
    try:
        base_model = library.require_ready(lib, p["base_model_id"])
    except AppError as e:
        raise JobFailure(e.message) from e
    dataset = _dataset(lib, p["dataset_id"])

    progress = ctx.progress
    export_state = _export_state(lib, dataset) if dataset.origin == "built" else "ready"
    if export_state == "building":
        # Another live job is writing this export. A second export would replace the folder under
        # it (and it under us), so this run stops rather than race it.
        raise JobFailure(
            f"Dataset {dataset.name} is being exported by another job; start this run again when it "
            "has finished."
        )
    if export_state != "ready":
        ctx.log.info("exporting dataset %s before training", dataset.name)
        export_dataset(ctx, dataset.id, lambda f, m: ctx.progress(EXPORT_SHARE * f, m))
        dataset = _dataset(lib, dataset.id)

        def progress(f: float, m: str = "") -> None:
            ctx.progress(EXPORT_SHARE + (1 - EXPORT_SHARE) * f, m)

    try:
        data_yaml = runs.check_data_yaml(runs.data_yaml_of(lib, dataset), dataset)
    except AppError as e:
        raise JobFailure(e.message) from e
    params = TrainParams(
        data_yaml=str(data_yaml),
        base_weights=str(library.weights_file(lib, base_model)),
        run_dir=str(lib.runs_dir / ctx.job_id),
        epochs=int(p.get("epochs", 50)),
        imgsz=int(p.get("imgsz", 1280)),
        batch=p.get("batch"),
        patience=int(p.get("patience", 50)),
        augmentation=p.get("augmentation", "default"),
        device=p.get("device", "0"),
    )
    ctx.log.info(
        "training %s on dataset %s (%s) for %s epochs", p["name"], dataset.name, data_yaml, params.epochs
    )
    with hold_gpu(ctx.log, "train", cancelled=ctx.cancelled):
        result = get_trainer().train(params, progress, ctx.cancelled, ctx.log)
    ctx.check_cancelled()
    artifacts = {
        "results_csv": result.results_csv,
        "confusion_matrix": result.confusion_matrix,
        "pr_curve": result.pr_curve,
    }
    train_gsd_cm = _train_gsd(ctx, lib, registry, dataset.id, params.imgsz)
    classes = list(dataset.classes or [])
    try:
        model = library.add_model(
            lib,
            source_weights=Path(result.best_weights),
            name=p["name"],
            origin="trained",
            task=dataset.task,
            class_names=[str(c["name"]) for c in classes],
            class_map={str(c["name"]): str(c["type_id"]) for c in classes},  # pre-filled (F §12.2)
            metrics=result.final_metrics or None,
            hyperparameters={k: v for k, v in asdict(params).items() if k not in PATH_PARAMS},
            train_gsd_cm=train_gsd_cm,
            artifacts={k: Path(v) for k, v in artifacts.items() if v is not None},
            provenance={
                **_single_project(lib, dataset),
                "dataset_id": dataset.id,
                "dataset_name": dataset.name,
                "run_id": ctx.job_id,
                "base_model_id": base_model.id,
                "base_model_name": base_model.name,
            },
        )
    except AppError as e:
        if e.code != "already_exists":
            raise JobFailure(e.message) from e
        # The run produced weights identical to a library model. Same weights are one library
        # model (as for starters), so the finished run is not thrown away: it returns that model.
        existing = library.get_model(lib, e.details["model_id"])
        ctx.log.info("these weights are already in the library as %s (%s)", existing.name, existing.id)
        return {"model_id": existing.id, "metrics": existing.metrics}
    ctx.log.info("registered library model %s (%s)", model.id, model.weights_path)
    return {"model_id": model.id, "metrics": model.metrics}
