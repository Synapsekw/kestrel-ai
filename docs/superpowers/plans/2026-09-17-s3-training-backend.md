# S3: Training Backend and Model Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S0 501 stubs for `models` with the real model registry and training subsystem: import weights, train YOLO in a cancellable subprocess with live progress, register every completed run with metrics and artifacts, export to ONNX or TensorRT through a job, delete models.

**Architecture:** `backend/app/training/` owns a `Trainer` interface with one implementation, `UltralyticsTrainer`, which never imports torch in the API process for training: it launches `python -m app.training.worker <params.json>` (or `<frozen exe> worker <params.json>` when frozen) and tails a JSON-lines progress file the worker writes from Ultralytics callbacks. Jobs `train` and `export` run through the S0 job runner; the job thread polls the subprocess, forwards progress and honours cancellation by terminating the process tree. Tests use a `FakeTrainer` (no GPU); one `@pytest.mark.gpu` test runs a real 1-epoch YOLO11n training.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2, ultralytics 8.4.154, torch 2.14.0+cu130 (pinned; never change), pytest.

**Spec:** `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` section 7 (owned), plus sections 4, 9, 11, 12, 15 (aerial preset default). Contract: `contract/openapi.yaml` (source of truth; do not edit).

## Global Constraints

- Contract paths carry `/api/v1`; response shapes must match `openapi.yaml` (`Model`, `ModelPage`, `ModelImport`, `TrainRequest`, `ExportRequest`, `JobRef`). Do not edit the contract; report gaps to the goal owner.
- Pins from the reference machine: torch 2.14.0+cu130, torchvision 0.29.0+cu130, ultralytics 8.4.154. Do not add or upgrade ML packages.
- Base weights for tests: `E:\Dev\Yolo\models\yolo11n.pt` and `yolo11m.pt` (read-only; the import endpoint copies them into the project). Sample frames: copy from `E:\Dev\Yolo\data\raw\ahmadia`, never the originals folder. Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`.
- Training runs in a subprocess so it can be cancelled and cannot take the API down (spec 7). Progress arrives through the Ultralytics callback API written as JSON lines; the API process must not import `ultralytics` or `torch` at module import time (import lazily inside functions that need them: model import reads class names, export runs in the worker too).
- Parameters exposed (spec 7): base model (any registry model), epochs, imgsz (default 1280), batch (null = auto), patience, augmentation preset `default` | `aerial` (`aerial` = Ultralytics defaults plus `flipud=0.5`, `fliplr=0.5`, `degrees=90`), device (`"0"` default, `"cpu"` allowed).
- Registry rows follow `app/db/models.py::Model`: `weights_path` relative to the project folder (`models/<file>.pt`), `kind` imported | trained, `metrics` per contract `ModelMetrics` (map50, map50_95, precision, recall, per_class[]) or null, `class_names` in index order, `class_aliases` (model class -> project class), `exports` {format: relative path}, `artifacts` {results_csv, confusion_matrix, pr_curve} relative paths, `run_id` = training job id.
- Dataset layout S3 consumes (produced by S1's materialise job; S3 must not depend on S1 code): `Dataset.path` = `datasets/<name>` relative to the project; `<path>/data.yaml` with `path` (absolute), `train: images/train`, `val: images/val`, `names: {0: excavator, ...}`; `Dataset.classes` JSON snapshot ordered like `names`. Tests create this layout by hand.
- Shared files S3 may touch: `app/training/**` (owned), `app/__main__.py` (add the `worker` subcommand dispatch only), `tests/test_contract.py` (only `EXPECTED_STUBS`), `tests/conftest.py` (add fixtures only). Nothing else.
- Never write a secret anywhere. Job logs go to the job log file; subprocess stdout/stderr are appended to it.
- TDD for every task; `ruff check` and `ruff format --check` clean. Commands run from `backend/` with `.\.venv\Scripts\python.exe`. Default `pytest` skips `gpu` tests; run them with `-m gpu` on the reference machine before reporting done.

## Interfaces from S0 you build on (read these first)

- `app/projects/service.py`: `ProjectHandle` (`folder`, `models_dir`, `runs_dir`, `datasets_dir`, `session()`, `row(s)`), `get_project`.
- `app/db/models.py`: `Model`, `Dataset`, `DatasetImage`, `Job`, `Project`.
- `app/jobs/registry.py`, `app/jobs/runner.py`: `register_job_type`, `JobContext` (`params`, `log`, `progress`, `check_cancelled`, `cancelled` event, `publish`), `JobRunner.submit`.
- `app/jobs/schemas.py`: `JobOut.from_row`.
- `app/pagination.py`.
- `app/training/router.py`: the stub you replace.

## File structure

```
backend/app/training/
  __init__.py
  router.py        routes for /projects/{p}/models (replaces the stub)
  schemas.py       ModelOut, ModelImport, TrainRequest, ExportRequest, ModelPage, JobRef
  registry.py      import/list/get/delete models; register a trained run; class-name reading
  trainer.py       Trainer protocol, TrainParams/TrainResult dataclasses, get_trainer(), UltralyticsTrainer (subprocess + tailing)
  worker.py        the subprocess entry: runs ultralytics train/export, writes progress.jsonl and done.json
  presets.py       augmentation presets and param -> ultralytics kwargs mapping
  jobs.py          job functions "train" and "export" registered with the runner
backend/tests/
  test_presets.py  test_trainer_progress.py  test_registry.py  test_training_jobs.py  test_training_gpu.py
```

---

### Task 1: Presets and parameter mapping

**Files:** Create `backend/app/training/presets.py`, `backend/tests/test_presets.py`.

**Interfaces:**
- Produces: `@dataclass(frozen=True) TrainParams: data_yaml: str; base_weights: str; run_dir: str; epochs: int = 50; imgsz: int = 1280; batch: int | None = None; patience: int = 50; augmentation: str = "default"; device: str = "0"`; `to_ultralytics_kwargs(p: TrainParams) -> dict` (`data`, `model` not included, `epochs`, `imgsz`, `batch` (-1 when None: Ultralytics auto batch), `patience`, `device`, `project=str(Path(run_dir))`, `name="train"`, `exist_ok=True`, `plots=True`, `verbose=False`, plus preset keys); `PRESETS = {"default": {}, "aerial": {"flipud": 0.5, "fliplr": 0.5, "degrees": 90.0}}`; unknown preset -> `ValueError`.

- [ ] Failing tests: default kwargs contain `epochs=50, imgsz=1280, batch=-1, patience=50, device="0"` and no flip keys; `aerial` adds the three keys; `batch=8` passes through; unknown preset raises. Then implement, run, commit `feat(training): parameter presets`.

---

### Task 2: Worker and progress protocol

**Files:** Create `backend/app/training/worker.py`, `backend/app/training/trainer.py` (dataclasses, protocol, progress reader; the subprocess launcher comes in Task 3), `backend/tests/test_trainer_progress.py`. Modify `backend/app/__main__.py`:

```python
import sys

if len(sys.argv) > 1 and sys.argv[1] == "worker":
    from app.training.worker import main as worker_main

    worker_main(sys.argv[2:])
else:
    from app.main import main

    main()
```

**Interfaces:**
- Produces:
  - Progress file protocol (`<run_dir>/progress.jsonl`): one JSON object per line, `{"kind": "epoch", "epoch": 3, "epochs": 50, "metrics": {"metrics/mAP50(B)": 0.31, ...}, "loss": {"box_loss": 1.2, "cls_loss": 0.8, "dfl_loss": 1.1}, "elapsed_s": 12.3, "eta_s": 190.1}` after every fit epoch; `{"kind": "start", "epochs": 50}` at start; done file `<run_dir>/done.json`: `{"ok": true, "best": "<abs path best.pt>", "save_dir": "<abs>", "final_metrics": {"map50", "map50_95", "precision", "recall", "per_class": [{"class_name", "map50", "map50_95", "precision", "recall"}]}}` or `{"ok": false, "error": "..."}`.
  - `read_progress(path: Path) -> list[dict]` (tolerates a partially written last line), `latest_epoch(events) -> dict | None`, `progress_fraction(events) -> float` (= epoch/epochs, 0 when none).
  - `worker.main(argv)`: `argv = ["train", params_json]` or `["export", params_json]`. Train: builds `YOLO(base_weights)`, adds callbacks `on_train_start` (write start line), `on_fit_epoch_end` (write epoch line from `trainer.epoch + 1`, `trainer.epochs`, `trainer.metrics`, `dict(zip(trainer.loss_names, trainer.tloss.tolist()))` when available, `time.time() - trainer.train_time_start`, eta = elapsed / (epoch) * (epochs - epoch)), `on_train_end` (final metrics from `trainer.validator.metrics`: `box.map50`, `box.map`, `box.mp`, `box.mr`, per class via `box.ap_class_index`, `box.ap50`, `box.ap`, `box.p`, `box.r`, names from `trainer.data["names"]`), then `model.train(data=..., **kwargs)`, writes `done.json`; any exception -> `done.json {"ok": false, "error": repr}` and exit code 1. Export: `YOLO(weights).export(format=..., imgsz=..., half=..., device=...)` -> `done.json {"ok": true, "path": "<abs exported file>"}`.
  - The worker process must set `os.environ.setdefault("YOLO_VERBOSE", "False")` and print progress lines to stdout too (the job log captures them).

- [ ] Failing tests (no GPU, no ultralytics): `read_progress` on a file with a truncated last line returns the complete lines; `progress_fraction` for epoch 3/10 is 0.3; the worker's callback helpers are unit-testable: extract `epoch_event(epoch, epochs, metrics, loss, elapsed) -> dict` and `final_metrics_from(box_metrics_like, names) -> dict` as pure functions and test them with a small fake object exposing `map50, map, mp, mr, ap_class_index, ap50, ap, p, r` arrays (numpy). Then implement, run, commit `feat(training): worker entry and progress protocol`.

---

### Task 3: UltralyticsTrainer subprocess launcher and FakeTrainer

**Files:** Modify `backend/app/training/trainer.py`; create `backend/tests/test_trainer_launch.py`.

**Interfaces:**
- Produces:
  - `class Trainer(Protocol): def train(self, params: TrainParams, on_progress: Callable[[float, str], None], cancelled: threading.Event, log: logging.Logger) -> TrainResult; def export(self, weights: Path, fmt: str, imgsz: int, half: bool, device: str, run_dir: Path, cancelled, log) -> Path`
  - `@dataclass TrainResult: best_weights: Path; save_dir: Path; final_metrics: dict; results_csv: Path | None; confusion_matrix: Path | None; pr_curve: Path | None` (artifact paths resolved from `save_dir`: `results.csv`, `confusion_matrix.png`, first existing of `BoxPR_curve.png`, `PR_curve.png`).
  - `UltralyticsTrainer`: writes `params.json` into `run_dir`, builds the command (`[sys.executable, "-m", "app.training.worker", "train", params_json]`, or `[sys.executable, "worker", "train", params_json]` when `getattr(sys, "frozen", False)`), starts it with `subprocess.Popen(cmd, cwd=<backend root or exe dir>, stdout=log_file, stderr=STDOUT, creationflags=CREATE_NEW_PROCESS_GROUP)`; loop every 0.5 s: `on_progress(progress_fraction(events), message)` with message `f"epoch {e}/{E} mAP50 {m:.3f}"` when a new epoch line appeared; if `cancelled.is_set()`: `proc.terminate()`; wait up to 10 s; `proc.kill()` on Windows via `taskkill /T /F /PID` to take the DataLoader workers down; raise `JobCancelled` (import from `app.jobs.runner`); on exit code != 0 or `done.json` `ok: false` raise `RuntimeError(error)`; on success return `TrainResult`. `export` mirrors this with the `export` subcommand.
  - `get_trainer() -> Trainer` returns `UltralyticsTrainer()`; tests monkeypatch `app.training.jobs.get_trainer`.
  - `class FakeTrainer` in `tests/fakes.py`: `train` writes a fake `results.csv` (columns `epoch,time,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B),val/box_loss,val/cls_loss,val/dfl_loss`), a 1-byte `weights/best.pt`, a `confusion_matrix.png`, calls `on_progress` for each of `epochs` epochs with a 20 ms sleep and checks `cancelled` (raising `JobCancelled`), returns `TrainResult` with `final_metrics` from constructor arguments; `export` writes `<stem>.onnx` next to the weights and returns it.

- [ ] Failing tests for the launcher without ultralytics: monkeypatch the command builder to run a tiny stand-in script (`tests/fake_worker.py`) that writes start/epoch lines with sleeps and a done.json; assert `on_progress` calls, `TrainResult` paths; cancellation: set `cancelled` after the first epoch and assert `JobCancelled` within 15 s and the process is gone; failure: stand-in writes `ok: false` -> `RuntimeError` with the message. Then implement, run, commit `feat(training): subprocess trainer with progress tailing and cancellation`.

---

### Task 4: Registry service and models endpoints (import, list, get, delete)

**Files:** Create `backend/app/training/registry.py`, `backend/app/training/schemas.py`, `backend/tests/test_registry.py`; modify `backend/app/training/router.py` (replace the stub file; keep `add_stubs` only for `trainModel` and `exportModel` until Task 5).

**Interfaces:**
- Produces:
  - `import_model(handle, name, weights_path: str, class_aliases: dict) -> Model`: validates absolute existing `.pt` (422), copies to `models/<slug(name)>-<8 hex>.pt`, reads `class_names` with `YOLO(weights).names` (lazy import inside the function; the file is opened once), `kind="imported"`, `hyperparameters={}`, `metrics=None`; duplicate names allowed (ids differ).
  - `list_models(handle, limit, cursor)` newest first with keyset cursor; `get_model(handle, model_id)` (404); `delete_model(handle, model_id)`: removes the row, the weights file and every file in `exports` (missing files ignored); boxes keep their `model_id` provenance.
  - `register_trained(handle, *, name, base_model: Model, dataset: Dataset, params: TrainParams, result: TrainResult, job_id) -> Model`: copies `best.pt` to `models/<slug(name)>-<job_id[:8]>.pt`, `kind="trained"`, `base_weights=base_model.weights_path`, `dataset_id`, `hyperparameters=asdict(params)` minus paths, `metrics=result.final_metrics`, `class_names` from the dataset class snapshot names, `artifacts` relative paths, `run_id=job_id`.
  - `ModelOut.from_row(row)` -> contract `Model` (`artifacts` only includes existing keys; `metrics` null or `ModelMetrics`).
  - Routes: `GET /models`, `POST /models/import` (201), `GET /models/{modelId}`, `DELETE /models/{modelId}` (204).

- [ ] Failing tests: import `E:\Dev\Yolo\models\yolo11n.pt` with aliases `{"truck": "dump_truck"}` -> 201, `class_names` has 80 entries starting `person, bicycle, car`, file copied under `models/`, `kind == "imported"`; relative or missing path -> 422; list paginates newest first; get 404; delete removes the file and the row; deleting an unknown id -> 404. (Reading class names loads torch once per test session: mark these tests normal, not gpu; they run on CPU.) Then implement, run, commit `feat(training): model registry api`.

---

### Task 5: Train and export jobs and endpoints

**Files:** Create `backend/app/training/jobs.py`, `backend/tests/test_training_jobs.py`, `backend/tests/fakes.py`; modify `router.py` (no stubs remain), `tests/test_contract.py` (`EXPECTED_STUBS` loses `listModels, importModel, trainModel, getModel, deleteModel, exportModel`).

**Interfaces:**
- Produces:
  - `POST /models/train` (`TrainRequest`): validates `dataset_id` exists and `<folder>/<dataset.path>/data.yaml` exists (422 `validation_error` with a clear message when the dataset is not materialised yet), `base_model_id` exists (404), `epochs >= 1`; submits job `train` with params `{name, dataset_id, base_model_id, epochs, imgsz, batch, patience, augmentation, device}`; 202 `JobRef`.
  - Job `train` (`run_train(ctx)`): builds `TrainParams(data_yaml=<abs data.yaml>, base_weights=<abs weights>, run_dir=<abs runs/<job_id>>, ...)`, `trainer = get_trainer()`, `result = trainer.train(params, on_progress=ctx.progress, cancelled=ctx.cancelled, log=ctx.log)`, `model = register_trained(...)`, returns `{"model_id": model.id, "metrics": model.metrics}`. Cancellation propagates as `JobCancelled` (the runner marks the job cancelled). Failures propagate (runner marks failed with the message).
  - `POST /models/{modelId}/export` (`ExportRequest`): 404 unknown model; submits job `export` with `{model_id, format, imgsz, half}`; 202 `JobRef`. Job `export`: `path = trainer.export(...)`, copies/moves the artifact to `models/<weights stem>.<onnx|engine>`, updates `Model.exports[format]` (relative path), returns `{"format", "path"}`.
- Consumes: `get_trainer`, `JobRunner.submit`, `register_trained`.

- [ ] Failing tests with `FakeTrainer` (monkeypatch `app.training.jobs.get_trainer`): set up a project, import yolo11n as base, insert a `Dataset` row and write `datasets/v1/data.yaml` + empty `images/train`, `images/val` folders by hand (helper in the test), `POST /models/train` -> 202 with `job.type == "train"`; wait for the job: succeeded, `result.model_id`, `GET /models/{id}` shows `kind == "trained"`, `metrics.map50 == <fake value>`, `dataset_id`, `base_weights`, `run_id == job id`, `artifacts.results_csv` relative path exists on disk, weights copied to `models/`; websocket receives `job.progress` events with epoch messages; cancel mid-training -> `cancelled` and no Model row; a `FakeTrainer(fail=True)` -> job `failed` with the error text and no Model row; train against a dataset without `data.yaml` -> 422; unknown base model -> 404; export -> 202, job succeeded, `exports.onnx` set and the file exists; export of an unknown model -> 404. Then run the contract test (`EXPECTED_STUBS` updated), the full suite three times, ruff; commit `feat(training): train and export jobs`.

---

### Task 6: Real GPU training test and smoke script

**Files:** Create `backend/tests/test_training_gpu.py`, `backend/scripts/smoke_train.py`.

- [ ] `@pytest.mark.gpu` test: skip unless `torch.cuda.is_available()`; build a real tiny dataset from 8 frames of `ahmadia_sample` downscaled to 640 px with one synthetic box label each (two classes), `data.yaml` by hand; import `yolo11n.pt`; `POST /models/train` with `epochs=1, imgsz=320, batch=4, device="0", patience=1`; wait up to 10 minutes; assert succeeded, `metrics` has the four numbers and `per_class` entries, `artifacts.results_csv` and `confusion_matrix` exist, `progress.jsonl` has a `start` and one `epoch` line; then `POST export {format: onnx, imgsz: 320}` succeeds and the `.onnx` file exists. Run it once on the reference machine with `pytest -m gpu -q tests/test_training_gpu.py` and paste the output in your report.
- [ ] `scripts/smoke_train.py`: CLI that, against a running dev backend, imports base weights, trains N epochs on a given dataset id and prints progress from the websocket (manual aid; no tests). Commit `test(training): gpu training test and smoke script`.

---

## Self-review checklist

- Spec section 7 coverage: trainer interface (T3), subprocess training with callback progress (T2/T3), exposed parameters (T1/T5), registry with metrics/confusion matrix/PR curve (T4/T5), imported weights (T4), ONNX/TensorRT export job (T5). Pre-annotation itself is S4's (it only reads `preannotation_model_id` and the registry).
- Every step has real test code or exact assertions; signatures of `TrainParams`, `TrainResult`, `Trainer.train/export`, `get_trainer`, `register_trained` are identical across tasks.
- No task imports `ultralytics`/`torch` at module level in `app/`.
