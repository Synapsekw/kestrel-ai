# S3: Training backend and model registry — implementation report

Branch `s3-training-backend`, worktree `E:\Dev\Yolo\app\.worktrees\s3-training-backend`, based on main `b233a82`.
Plan: `docs/superpowers/plans/2026-09-17-s3-training-backend.md`. Contract: `contract/openapi.yaml` (unchanged).

## Commits

| SHA | Task | Message |
| --- | --- | --- |
| `5a9e358` | 1 | feat(training): parameter presets |
| `72f37a7` | 2 | feat(training): worker entry and progress protocol |
| `cc87bc3` | 3 | feat(training): subprocess trainer with progress tailing and cancellation |
| `ed8b9e7` | 4 | feat(training): model registry api |
| `535fb4d` | 5 | feat(training): train and export jobs |
| `9fae568` | 6 | test(training): gpu training test and smoke script |
| `4f036d0` | self-review | fix(training): reject unloadable weights without leaving a copy behind |

## Final verification

```
$ .\.venv\Scripts\python.exe -m pytest -q
155 passed, 1 deselected in 21.90s          # the deselected one is the gpu test

$ .\.venv\Scripts\ruff.exe check .
All checks passed!
$ .\.venv\Scripts\ruff.exe format --check .
60 files already formatted

$ .\.venv\Scripts\python.exe -m pytest -m gpu -q tests/test_training_gpu.py
.                                                                        [100%]
1 passed in 16.02s
```

Full suite run three times after task 5 (plan requirement): `150 passed in 23.93s / 24.84s / 22.73s`.
Baseline before any work: `97 passed in 15.61s`.

## Per task

### Task 1 — presets and parameter mapping (`app/training/presets.py`)

`TrainParams` (frozen dataclass, defaults straight from the contract's `TrainRequest`) and
`to_ultralytics_kwargs`. `PRESETS = {"default": {}, "aerial": {flipud 0.5, fliplr 0.5, degrees 90.0}}`
(spec section 15); an unknown preset raises `ValueError`. `batch=None` maps to `-1` (Ultralytics auto batch).

RED: `ModuleNotFoundError: No module named 'app.training.presets'`. GREEN: `7 passed in 0.03s`.

One kwarg beyond the plan's list was added in task 6 (`amp`) — see *Deviations*.

### Task 2 — worker and progress protocol (`app/training/worker.py`, `app/training/trainer.py`)

- `<run_dir>/progress.jsonl`: `{"kind": "start", "epochs": N}` then one `epoch` line per fit epoch with
  `metrics`, `loss`, `elapsed_s`, `eta_s`; `<run_dir>/done.json` written atomically through a `.tmp` replace
  so the parent never reads a half-written result.
- Pure, unit-tested helpers: `read_progress` (skips a truncated last line), `latest_epoch`,
  `progress_fraction`, `epoch_message`, `epoch_event`, `final_metrics_from`, `losses_from`, `is_new_fit_epoch`.
- `app/__main__.py` dispatches `worker` to `app.training.worker.main` (frozen-exe path), everything else to
  the server.
- A regression test launches a subprocess importing `app.api` and the training modules and asserts
  `torch` and `ultralytics` are absent from `sys.modules` — the ML stack only loads in the worker.

RED: `ImportError` on `app.training.trainer`, then `ValueError: The truth value of an array with more than one
element is ambiguous` from `final_metrics_from` (numpy truthiness on `ap_class_index`). GREEN: `12 passed`.

### Task 3 — `UltralyticsTrainer` and `FakeTrainer`

`UltralyticsTrainer` writes `params.json`, builds `[sys.executable, "-m", "app.training.worker", cmd, params]`
(or `[exe, "worker", ...]` when frozen), runs it with `cwd = backend/`, `CREATE_NEW_PROCESS_GROUP`, and
stdout/stderr appended to the job log file taken from the job logger's `FileHandler`. It polls every
`poll_s` (0.5 s in production), emits `on_progress(fraction, "epoch e/E mAP50 x.xxx")` on each new epoch, and
on cancellation kills **its own** process tree (`taskkill /T /F /PID` on Windows, so dataloader children go
too) and raises `JobCancelled`. A non-zero exit, a missing `done.json` or `ok: false` becomes a `RuntimeError`.

Tests drive the real launcher against `tests/fake_worker.py`, a stand-in that speaks the same file protocol
(scripted through a `fake.json` sidecar: epoch sleep, hang, failure, exit code). Cancellation asserts
`JobCancelled` inside 15 s, `trainer.process.poll() is not None` and that the stand-in never reached its
`finished.txt`. `tests/fakes.py::FakeTrainer` is the in-process double used by the job tests.

RED: `ImportError: cannot import name 'UltralyticsTrainer'`; then `ModuleNotFoundError: No module named
'tests.fakes'` (pytest puts `tests/` itself on `sys.path`, so the import is `from fakes import FakeTrainer`).
GREEN: `12 passed in 1.77s`.

### Task 4 — registry and endpoints (`registry.py`, `schemas.py`, `router.py`)

`import_model` (copy to `models/<slug>-<8 hex>.pt`, class names read from the copy), `list_models` (keyset
cursor, newest first), `get_model`, `get_dataset`, `delete_model` (row + weights + every export file),
`set_export`, `register_trained`, plus `ModelOut/ModelPage/ModelImport/TrainRequest/ExportRequest/JobRef`.
`ModelOut.artifacts` only carries keys that exist; `metrics` is `null` or the full `ModelMetrics`.

Import of the real `E:\Dev\Yolo\models\yolo11n.pt` returns 80 class names starting `person, bicycle, car`;
the source file is copied, never moved. Deleting a model keeps `Box.model_id` provenance (asserted).

RED: `ModuleNotFoundError: No module named 'app.training.registry'`. GREEN: `12 passed in 2.89s`
(now 13 with the self-review test).

### Task 5 — train and export jobs (`jobs.py`)

`POST /models/train` → 404 unknown base model, 404 unknown dataset, 422 when the dataset has no `data.yaml`
yet, else 202 `JobRef`. The `train` job builds `TrainParams`, runs `get_trainer().train(...)` forwarding
`ctx.progress` and `ctx.cancelled`, then `register_trained(...)`, returning `{"model_id", "metrics"}`.
`POST /models/{id}/export` → 404 unknown model, else 202; the `export` job moves the artifact to
`models/<weights stem>.<fmt>` and records `Model.exports[fmt]`.

Tests build the S1 dataset layout by hand (`datasets/v1/{images,labels}/{train,val}` + `data.yaml`) and insert
the `Dataset` row directly — no dependency on S1 code. They cover success, the websocket `job.progress`
messages (`epoch 1/3 mAP50 0.500` …), cancellation (job `cancelled`, no `Model` row), failure (job `failed`
with the error text and a traceback in the job log), 422/404 paths and export.

RED: 10 failures. GREEN: `10 passed in 2.31s`. `EXPECTED_STUBS` lost the six model operations and
`test_no_extra_api_routes` / `test_every_spec_path_is_routed` still pass, so no stub remains under `/models`.

### Task 6 — GPU test and smoke script

`tests/test_training_gpu.py` (marked `gpu`, skipped by default): copies 8 real frames from
`E:\Dev\Yolo\data\raw\ahmadia`, downscales them to 640 px into a project-local dataset with one synthetic box
label each (two classes), imports `yolo11n.pt` (copied to a temp file first — the shared models folder is a
read-only input), trains 1 epoch at `imgsz=320, batch=4, patience=1, device="0", augmentation=aerial`, then
exports to ONNX. It asserts the `start` line plus exactly one `epoch` line with real losses, the four metric
numbers and `per_class` entries, `results.csv`, `confusion_matrix.png` and the copied weights on disk.

```
$ .\.venv\Scripts\python.exe -m pytest -m gpu tests/test_training_gpu.py -v
configfile: pyproject.toml
plugins: anyio-4.15.1, hypothesis-6.168.0, asyncio-1.4.0, schemathesis-4.27.3
collecting ... collected 1 item

tests/test_training_gpu.py::test_train_one_epoch_on_the_gpu_and_export PASSED [100%]

============================= 1 passed in 17.03s ==============================
```

Two real bugs were found by this test and fixed:

1. Ultralytics fires `on_fit_epoch_end` a second time for its final validation (`trainer.py:989`, with
   `epoch += 1`), so a 1-epoch run wrote two epoch lines. `is_new_fit_epoch(last, epoch, epochs)` now keeps
   one line per real fit epoch.
2. In ultralytics 8.4 `trainer.tloss` is a **dict** of running means, not a tensor, so the plan's
   `dict(zip(loss_names, tloss.tolist()))` produced an empty `loss` object. `losses_from` handles both shapes.

`backend/scripts/smoke_train.py` is the manual aid: imports base weights against a running dev backend, starts
a training job and prints websocket progress until the job ends (`--help` verified; no tests, as planned).

## Deviations from the plan, with reasons

1. **Bad `weights_path` on import answers 404, not 422** (task 4). The contract does not constrain
   `weights_path` beyond `type: string`, so `""` is a schema-valid body, and the contract conformance test
   (`schemathesis` `positive_data_acceptance`) fails any 422 on schema-valid data — it broke
   `test_responses_conform[POST …/models/import]`. A path that points at no file is a missing reference, so
   `not_found` (404) is the closest behaviour inside the contract. A `.pt` that exists but torch cannot load
   is still 422 `validation_error` (unreachable from generated data). The same reasoning made
   `POST /models/train` answer 404 for an unknown `base_model_id`/`dataset_id` and keep 422 only for the
   "dataset not materialised yet" case, which generated data cannot reach.
2. **`amp` added to the Ultralytics kwargs**: `"bf16"` on a GPU, `False` on the CPU. With the default
   (`amp=True`) Ultralytics runs an AMP probe that downloads `yolo26n.pt` into `backend/weights/` the first
   time any machine trains on CUDA (`ultralytics/utils/checks.py::check_amp`), which the task rules forbid and
   a packaged offline app cannot rely on (spec section 10). `amp="bf16"` is a documented Ultralytics value
   (`default.yaml`: "True/'fp16' (AMP check), 'bf16', or False/'fp32'") that skips the probe and keeps mixed
   precision on the Ampere-and-later GPUs this app targets (RTX 5070 Ti here). Verified: no `backend/weights/`
   directory exists after the GPU run, i.e. nothing was downloaded.
3. **The worker sets `YOLO_AUTOINSTALL=False`** next to `YOLO_VERBOSE=False`. Ultralytics otherwise
   `pip install`s missing optional dependencies (for example `onnx` during an export) into the user's
   environment; that is forbidden here and wrong for a packaged app. A missing dependency now fails the job
   with a readable message instead.
4. **`is_new_fit_epoch` and `losses_from`** (task 6 findings above) refine the plan's task 2 callback recipe.
5. **`TrainParams` lives in `presets.py`** (as task 1 specifies) and `trainer.py` imports it; task 2's
   "dataclasses" therefore means `TrainResult` only.
6. **`FakeTrainer` landed in task 3** (where the plan defines it) rather than task 5, with two tests pinning it
   to the same contract as the real trainer, so it is not untested scaffolding.

## Contract gaps to report to the goal owner

- `ModelImport.weights_path` has no format constraint, so the conformance test forbids a 422 there
  (deviation 1). A `minLength: 1` plus a note that the path must be absolute would let the backend answer
  `validation_error`, which is the more accurate code.
- `ExportRequest` has no `device`, so the export job picks one: `cpu` for `onnx`, `"0"` for `engine`
  (a TensorRT engine must be built on the GPU it runs on). `half: true` is accepted by the contract but only
  meaningful on a GPU; an ONNX export with `half: true` will fail on the CPU path.
- `TrainRequest.name` has no uniqueness rule, and `Model.name` is not unique in the DB: two models can share a
  name (ids and file names differ). The registry allows it deliberately; the UI may want to warn.
- Nothing in the contract exposes `progress.jsonl` or the run folder; the UI can only see epoch progress
  through `job.progress` messages and the job log. That matches spec section 7 but is worth confirming.

## Concerns / notes for the next wave

- **ONNX export is not verified end to end**: `onnx`, `onnxruntime`, `onnxslim` and `tensorrt` are not
  installed in the shared venv and I must not install anything. The GPU test therefore asserts the honest
  behaviour in this environment — the export job fails with a message naming `onnx` and installs nothing — and
  switches to full success assertions automatically once `onnx` is present. The export code path itself
  (job, artifact move, `Model.exports`, 404s) is covered with `FakeTrainer`. Someone must add `onnx` (and
  TensorRT for `engine`) to the environment and re-run `pytest -m gpu` to close this.
- `Model.metrics` for a trained run comes from the validator at `on_train_end`, not from `results.csv`
  (spec section 7 mentions `results.csv`). The validator numbers are the same final metrics and carry the
  per-class breakdown the contract needs; `results.csv` is registered as an artifact.
- Training runs through the API in a subprocess whose working directory is the **backend source folder**. In a
  frozen build that becomes the exe folder and the command becomes `<exe> worker …`; that path is implemented
  but untested (no frozen build here).
- The job runner has two worker threads, so two trainings can run at once and will compete for the GPU.
  Serialising GPU jobs is outside S3's plan but worth a look.
- S1 owns dataset materialisation; S3 only reads `<dataset.path>/data.yaml` and the `Dataset.classes`
  snapshot for `class_names`. If S1's snapshot ends up ordered differently from `data.yaml`'s `names`, the
  registered `class_names` would be misordered — worth a cross-check when S1 lands.

## Files changed

Added: `app/training/{presets,worker,trainer,registry,schemas,jobs}.py`, `scripts/smoke_train.py`,
`tests/{fakes,fake_worker,test_presets,test_trainer_progress,test_trainer_launch,test_registry,
test_training_jobs,test_training_gpu}.py`.
Modified: `app/training/router.py` (stub file replaced), `app/__main__.py` (worker dispatch only),
`tests/conftest.py` (fixtures only: `backend_dir`, `project`, `project_id`, `handle`),
`tests/test_contract.py` (`EXPECTED_STUBS` only). Nothing outside `app/training`, `tests/`, `scripts/` and
those three shared files was touched; `contract/openapi.yaml` is untouched.

---

# Fix round 1 (review of b233a82..4f036d0)

Commits added: `5c6d9ed` (cherry-pick of the goal owner's contract commit, see finding 3) and
`1c385b2` fix(training): review round 1 — freeze_support, bf16 probe, dataset drift.

## Verification

```
$ .\.venv\Scripts\python.exe -m pytest -q
168 passed, 1 deselected in 22.28s

$ .\.venv\Scripts\ruff.exe check .
All checks passed!
$ .\.venv\Scripts\ruff.exe format --check .
60 files already formatted

$ .\.venv\Scripts\python.exe -m pytest -m gpu -q tests/test_training_gpu.py
.                                                                        [100%]
1 passed in 22.27s          # now runs the real ONNX export assertions (onnx 1.22.0 installed)

$ .\.venv\Scripts\python.exe -m pytest -q -k "dispatch or amp_setting or malformed_params or drifted or intermediate_onnx or empty_weights or bad_weights"
17 passed, 152 deselected in 1.97s
```

No `backend/weights/` directory exists after the GPU run: the new amp decision still avoids the
Ultralytics AMP probe download.

## Finding 1 — `freeze_support()` before the dispatch — done

`app/__main__.py` is now `run(argv, freeze_support=multiprocessing.freeze_support)`, which calls
`freeze_support()` as its first statement and is executed under `if __name__ == "__main__":`. In a frozen
build the DataLoader children (`<exe> --multiprocessing-fork <handle>`) are consumed by `freeze_support()`
and never reach the dispatch; for a real launch it is a no-op.

Covering tests (`tests/test_trainer_progress.py`):
`test_dispatch_runs_freeze_support_before_anything_else` (injects a `freeze_support` that raises
`SystemExit`, as it does for a forked child, and asserts `app.main.main` was never called),
`test_dispatch_starts_the_api_for_a_normal_launch` (asserts the call order `["freeze", "api"]`, so the
ordering itself is pinned), `test_dispatch_routes_the_worker_subcommand`.
RED before the change: `ImportError: cannot import name 'run' from 'app.__main__'`.

## Finding 2 — bf16 only where the GPU supports it — done

`amp` left `to_ultralytics_kwargs`; `app/training/worker.py` now has

```python
def amp_setting(device: str, bf16_supported: Callable[[], bool] = cuda_bf16_supported) -> bool | str:
    if device.strip().lower() == "cpu":
        return False
    return "bf16" if bf16_supported() else False
```

with `cuda_bf16_supported()` calling `torch.cuda.is_bf16_supported(including_emulation=False)` (falling
back to the no-keyword signature, and to `False` on any error). `run_train` adds the key after building the
kwargs. Pre-Ampere cards therefore train in fp32 instead of hitting an autocast error, and the AMP probe is
still never run.

Covering tests: `test_amp_setting_never_asks_for_unsupported_bf16` — parametrised over
`("0", True) -> "bf16"`, `("0", False) -> False`, `"cpu"`, `"CPU"`, `" cpu "` and `"0,1"` with an injected
predicate (no torch needed); `test_amp_is_left_to_the_worker` in `test_presets.py` pins that the API-side
mapping carries no `amp` key. RED before the change: 6 parametrised failures plus 2 in `test_presets.py`.

## Finding 3 — `weights_path` — partially done, one point needs your call

Done: the contract's `minLength: 1` is now mirrored by `ModelImport.weights_path = Field(min_length=1)`, so
an empty value is a 422 `validation_error` (`test_import_rejects_an_empty_weights_path`).

**Not done — 422 for a relative or missing path is not achievable in the current gate.** I implemented it
exactly as asked and `tests/test_contract.py` failed:

```
[422] Unprocessable Content:
  {"error":{"code":"validation_error","message":"weights_path must be an absolute path to an existing
   .pt file; got '00'","details":{}}}
curl -X POST ... -d '{"name": "yolo11m-coco", "weights_path": "00", "class_aliases": {...}}'
schemathesis.openapi.checks.RejectedPositiveData: API rejected schema-compliant request
  Expected: 2xx, 401, 403, 404, 409, 429, 5xx
```

`minLength: 1` only removes the empty string from the generated data; `"00"` is still schema-compliant, and
`positive_data_acceptance` fails **any** 422 on a schema-compliant body. No schema can express "this file
exists", so as long as that check is active the only passing answer for a schema-valid but unusable path is
404. The code therefore keeps 404 `not_found` there, with the reasoning in a comment at
`app/training/registry.py` and in the test docstring.

Two one-line ways to get the 422 you want, both in files I am not allowed to edit — tell me which and I
will implement it in round 2:
- `tests/test_contract.py`: add `positive_data_acceptance` to the `excluded` list (it would then be
  excluded for every operation, or the test needs a per-operation carve-out), or
- accept 404 as the contract's answer for a missing weights file and adjust the description at
  `openapi.yaml:1660` ("422 otherwise") to say 404 — the description is currently the only place that
  promises 422.

Note on `5c6d9ed`: the contract change lives on `main` (4ef79e1) and my branch is based on `b233a82`, so the
conformance test read the old spec. Since I may not edit `contract/openapi.yaml` and may not run
`git merge`/`git checkout`, I brought the owner's commit in verbatim with `git cherry-pick -x` (it also
carries `contract/client/schema.d.ts`). Drop it if you prefer to merge `main` into the branch at
integration time.

## Finding 4 — dataset class drift — done

`check_materialised` now also reads `data.yaml` and compares its `names` (in class-index order, mapping or
list) with the `Dataset.classes` snapshot, answering 422 `validation_error` naming both lists when they
differ. Both the endpoint and the job go through it.
Test: `test_train_rejects_a_dataset_whose_yaml_drifted_from_its_class_snapshot` (swaps the two names in
`data.yaml` and asserts 422 with both names in the message).

## Finding 5 — TensorRT leaves an ONNX behind — done

After a non-`onnx` export, `run_export` registers `models/<stem>.onnx` under `exports["onnx"]` when the file
exists and no ONNX export is recorded yet, so `delete_model` removes it. `FakeTrainer.export` now writes the
intermediate for any non-ONNX format, mirroring Ultralytics.
Test: `test_engine_export_also_records_the_intermediate_onnx` — both exports recorded and on disk, then a
`DELETE` leaves neither file behind.

## Finding 6 — cancel mid-training — done

`test_cancelling_training_leaves_no_model` now calls a new `wait_for_progress` helper that polls until
`job.progress > 0` (asserting the job is still queued/running meanwhile) before cancelling, so the test
exercises the mid-training cancellation path rather than a pre-start cancel.

## Finding 7 — malformed `params.json` — done

`worker.main` seeds `run_dir` from the params file's own folder (the launcher writes `params.json` into the
run folder) and parses the JSON inside the `try`, so a malformed file still produces
`done.json {"ok": false, "error": ...}` and exit code 1.
Test: `test_worker_writes_done_json_for_a_malformed_params_file`.

## New concern from this round

`app/training/jobs.py` now imports `yaml` at module level. PyYAML is installed and pinned in
`requirements-lock.txt` (6.0.3) as an ultralytics dependency, but it is not listed in
`backend/requirements.txt`, which is outside the files I may touch. Please add `pyyaml` there (or tell me to)
so the direct dependency is declared.
