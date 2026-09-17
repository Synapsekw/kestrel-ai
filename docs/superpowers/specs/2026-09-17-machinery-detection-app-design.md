# Machinery Detection App: PRD and Design

Date: 2026-09-17
Status: approved for implementation (sections 1 to 4 reviewed with the owner; sections 5 to 13 decided by the design session under the approved constraints)
Working name: "the app" until the owner picks a name. The Label Studio name and logo are trademarked and must not be used.

---

## 1. Product definition

### Problem
The team collects large batches of nadir aerial imagery of construction sites (thousands of 24 MP frames per flight) and needs to find, count and track construction machinery in them. Today this requires stitching together Label Studio, ad-hoc scripts and the Ultralytics CLI. Nobody on the team should need a terminal to go from a folder of images to a trained detector and a report.

### Users
Internal team members on Windows workstations with an NVIDIA GPU. One person works on one project at a time on one machine. The app is not sold or distributed outside the team, so the Ultralytics AGPL license imposes no obligation.

### Goal
A single installable Windows desktop application that takes a folder of images and produces a trained YOLO model and reviewed detections, with a labeling experience at least as good as Label Studio's image bounding-box editor.

### V1 scope (all required)
1. Dataset import and preparation: pick folders, convert and downscale, deduplicate, group by flight or tile, per-site statistics.
2. Bounding-box annotation: Label Studio style editor with classes, hotkeys, zoom and pan, pre-annotations from any model, review queue.
3. Training and model registry: pick a dataset and base model, run YOLO training with live progress, keep every model with its metrics.
4. Inference with local models and cloud vision providers: run a trained model, or an OpenAI or Anthropic vision model with a free-text query, over new images; review results; promote them to labels.

### Non-goals for v1
Multi-user collaboration, cloud sync, non-image media, segmentation or keypoints, macOS or Linux builds, auto-update, telemetry.

### Success criteria
- End-to-end acceptance run (section 13.5) passes on the reference machine with the ahmadia dataset.
- A new user labels 50 images with pre-annotations in under 30 minutes without documentation.
- Training a YOLO11n model on 200 labeled images completes from the UI with progress visible and the model appearing in the registry.
- A cloud provider query over 20 images returns reviewed boxes that can be promoted and included in a dataset.
- Installer under 6 GB, cold start under 15 seconds on the reference machine.

---

## 2. Locked decisions

These were made with the owner and are not to be re-litigated by implementers.

| Decision | Choice |
|---|---|
| Form factor | Windows desktop app, one install per machine |
| Collaboration | One person per project per machine; project is a self-contained folder |
| Shell | Tauri 2 (not Electron) |
| UI | React 18, TypeScript, Vite, Konva canvas, Tailwind |
| Backend | Python 3.11, FastAPI, frozen with PyInstaller, bundled as a Tauri sidecar |
| Contract | OpenAPI spec is the source of truth; generated TypeScript client; mock server for UI development |
| Annotation UI | Built by us with Label Studio as the UX blueprint. No Label Studio code vendored |
| Detection library | Ultralytics YOLO behind a trainer interface; no second model family in v1 |
| Cloud providers | OpenAI and Anthropic vision models behind a provider interface |
| Storage | SQLite per project; images and labels on disk in the project folder |
| Secrets | Windows Credential Manager via the keyring library; never in project folders |

---

## 3. Architecture

One repository with three top-level parts.

- `backend/` is a Python 3.11 FastAPI service. It owns everything that touches files, the GPU or the network: datasets, annotation storage, training jobs, inference providers, the model registry. One process, an in-process job runner for long work, no UI. Frozen with PyInstaller into a one-folder build that includes CUDA PyTorch.
- `frontend/` is the Tauri 2 app: React, TypeScript, Vite, Konva for the canvas. It talks to the backend only over HTTP and one websocket for job events. The Rust layer is configuration only: window, file dialogs (tauri-plugin-dialog), sidecar (tauri-plugin-shell), Windows installer (NSIS via the Tauri bundler).
- `contract/` holds `openapi.yaml`, the generated TypeScript client, and the mock server config. The backend validates responses against the spec in tests.

### Process model
The app starts, Tauri launches the sidecar on a free localhost port with a one-time bearer token passed by environment variable, polls `/health` until ready (timeout 60 s with a visible splash), then loads the UI. On exit the sidecar is terminated. One backend per app instance. All backend endpoints require the token. Nothing leaves the machine except calls to cloud providers the user configured.

### Where data lives
- Project folder (user-chosen): `project.db` (SQLite), `images/<source>/`, `labels/`, `datasets/<name>/`, `runs/<job>/`, `models/`, `cache/thumbs/`.
- App data (`%APPDATA%/<app>/`): settings, recent projects, provider configuration (not keys), app log.
- Credential Manager: provider API keys, keyed by provider name.

---

## 4. Data model

SQLite tables unless noted. Migrations via Alembic. Primary keys are UUIDs.

- **Project**: name, class list (name, colour, hotkey, order), schema version, created_at.
- **Source**: imported folder path, site name, preparation settings (max side, quality, dedupe threshold), import time. Originals are never modified. Re-import picks up new files only.
- **Image**: path relative to project, width, height, source_id, capture_time and lat/lon/alt from EXIF when present, phash, group key (flight id from filename pattern, else geographic tile, else source), created_at.
- **Box**: image_id, class_id, x, y, w, h in pixels, confidence, provenance (`kind`: person | local_model | cloud_provider; `model_id` or `provider` + `model_name` + `query_run_id`), created_at, review_state (unreviewed | accepted | rejected | edited), reviewed_at. Accepted and edited boxes are ground truth; everything else is a proposal.
- **Dataset**: name, frozen list of image_ids with their accepted boxes at freeze time, class list snapshot, split assignment per image (train | val), split method (by_group | by_tile | random) and parameters, materialised path in YOLO format, created_at. Immutable after creation.
- **Model**: name, kind (imported | trained), weights path, base weights, dataset_id, hyperparameters, final metrics (mAP50, mAP50-95, precision, recall per class), run_id, created_at.
- **Job**: type (import | train | infer | export), state (queued | running | succeeded | failed | cancelled), progress 0..1, message, log path, result reference, started_at, finished_at.
- **QueryRun**: model_id or provider config, free-text query, image_ids, tiling settings, job_id, created_at. Its boxes are Box rows with provenance pointing back to it. Promoting a run marks its boxes accepted; it is a state change, not a copy.

Consequences: labels are per image, so several datasets can be cut from one labeling effort; pre-annotation is just a box with model provenance awaiting review, so local and cloud paths are identical downstream.

---

## 5. Dataset subsystem

Port of the existing `E:\Dev\Yolo\scripts\prepare_images.py` logic into `backend/app/datasets/`.

- **Import job**: walk the folder, convert to JPEG quality 95 with EXIF rotation applied and EXIF preserved, downscale when the long side exceeds 4000 px (configurable), compute phash, read EXIF time and GPS, derive group key. Runs in a process pool. Emits progress per 50 images.
- **Deduplication**: phash Hamming distance at or below 4 marks the later image as a duplicate of the earlier one; duplicates are recorded but not imported. Threshold is a per-import setting.
- **Grouping**: group key priority is filename flight pattern (regex configurable, default matches `<camera>_<flight>_<frame>`), then 250 m geographic tile from GPS, then source folder. Group key is what splits respect.
- **Split**: when creating a dataset the user picks by_group (default), by_tile or random, and a validation fraction (default 0.2). by_group assigns whole groups to val until the fraction is reached, largest groups first to train. The method and seed are stored.
- **Materialise**: write `datasets/<name>/images/{train,val}` as hard links or copies (hard links when on the same volume), `labels/{train,val}/*.txt` in YOLO normalised format, and `data.yaml`.
- **Statistics endpoint**: per source and per group counts, resolution histogram, capture date range, GPS bounding box, boxes per class, unlabeled count.

---

## 6. Annotation subsystem

Label Studio is the UX blueprint. Implementers should read its editor and Data Manager on GitHub for interaction details but write our own code.

### Screens
1. **Projects**: open recent, create new (name, folder, classes), import a project folder.
2. **Data Manager**: virtualised grid and list views of images with thumbnails, columns (file, source, group, labeled, box count, review pending, capture time), filters and sort on every column, multi-select, bulk actions (label selected, run model on selected, add to dataset, delete). Keyboard: J and K to move, Enter to open.
3. **Labeling editor**: image on a Konva stage with zoom (wheel), pan (space-drag), fit (F), 1:1 (1). Class sidebar with colour swatches and hotkeys 1 to 9. Draw a box by dragging; move, resize by handles; delete with Delete; duplicate with Ctrl+D. Region list panel with per-box class, confidence, provenance badge and review state. Pre-annotation boxes render dashed until accepted (A accepts all visible proposals, R rejects, click-edit accepts as edited). Next and previous image with Ctrl+Right and Ctrl+Left; auto-save on navigation. Undo and redo (Ctrl+Z, Ctrl+Y) per image.
4. **Review queue**: images with unreviewed proposals, sorted by proposal confidence, with the same editor.
5. **Project settings**: classes (add, rename, recolour, rehotkey), pre-annotation model, provider keys, import defaults.

### Behaviour
- Every edit becomes a Box row via the API immediately with review_state edited or accepted; undo issues compensating calls. No client-only state that could be lost.
- Images larger than the viewport are served as JPEG at the requested max side by the backend (`/images/{id}/file?max_side=`), with thumbnails cached at 256 px.
- Class changes never delete boxes; deleting a class requires reassigning or deleting its boxes explicitly.

---

## 7. Training and model registry

- **Trainer interface** in `backend/app/training/trainer.py`: `train(dataset, base_model, params, progress_cb) -> Model`, `export(model, format)`. One implementation, `UltralyticsTrainer`.
- **Training job**: runs `ultralytics` in a subprocess so it can be cancelled and cannot take the API down. Progress comes from the Ultralytics callback API written to a JSON lines file that the job runner tails, giving epoch, loss terms, mAP and ETA. Logs stream to the job log.
- **Parameters exposed**: base model (any registry model, including imported COCO weights), epochs, image size (default 1280), batch (default auto), patience, augmentation preset (default | aerial), device.
- **Registry**: every completed run registers a Model with metrics from `results.csv` and the confusion matrix and PR curve images from the run folder. Imported weights are registered with kind imported. Models can be exported to ONNX and TensorRT via a job.
- **Pre-annotation**: the project's selected model runs on an image when the editor opens it if the image has no boxes from that model yet, at image size 2560 by default on the GPU, and writes proposal boxes.

---

## 8. Inference and providers

### Provider interface
`backend/app/providers/base.py`: `detect(image_path, query, classes, tiling) -> list[Detection]` where Detection has label, box in pixels, confidence, raw response reference. Implementations:

- **LocalYoloProvider**: any registry model. Class names map to project classes by exact name, and additionally through a per-model alias table (for COCO weights: truck to dump_truck). Unmapped classes are dropped.
- **OpenAIProvider**: OpenAI Responses API with image input, JSON schema output for a list of boxes with normalised coordinates. Model name configurable.
- **AnthropicProvider**: Anthropic Python SDK, Messages API with base64 image input and structured output through `output_config.format` with a JSON schema for the box list. Default model `claude-opus-5`, configurable. Adaptive thinking left at default, `max_tokens` 16000, streaming not required for this response size. Handle `stop_reason == "refusal"` by recording an empty result with the refusal category on the job log.

### Tiling
Shared by all providers. Images are cut into tiles of a configurable size (default 1280 px, overlap 0.2) before sending; provider boxes are mapped back to full-image pixels and merged with NMS at IoU 0.5. Local YOLO uses the same path so that results are comparable.

### Query run job
Rate limited per provider (configurable requests per minute), retries with backoff on 429 and 5xx, resumable: each image-tile result is persisted as it arrives, so a restarted job skips finished tiles. Cost estimate shown before start: images times tiles times a per-provider estimate the user can edit in settings.

### Promotion
"Promote run" marks the run's accepted boxes as ground truth. Boxes are accepted individually in the review queue or in bulk with a confidence threshold.

---

## 9. API contract

Base path `/api/v1`, JSON, bearer token on every request. Resources:

- `projects`: create, open (by folder), get, update classes.
- `sources`: create (starts import job), list, stats.
- `images`: list with filter, sort, pagination; get; file (with max_side); thumbnail.
- `boxes`: list by image; create; update; delete; bulk review (accept, reject).
- `datasets`: create (freeze and materialise), list, get, stats.
- `models`: list, import, get, export (job), delete.
- `providers`: list configured; set key (writes to Credential Manager); test.
- `query-runs`: create (job), get, promote.
- `jobs`: list, get, cancel, log tail.
- `ws /events`: job progress and state changes as `{type, job_id, progress, message, payload}`.

Errors use one shape: `{error: {code, message, details}}`. Every list endpoint paginates with `limit` and `cursor`.

---

## 10. Packaging, configuration, security

- Backend build: PyInstaller one-folder with hidden imports for ultralytics and torch; CUDA DLLs included; smoke test runs `torch.cuda.is_available()` and one prediction on the built artifact in CI.
- Frontend build: `tauri build` produces an NSIS installer that bundles the backend folder as a sidecar. WebView2 bootstrapper enabled for Windows 10.
- Configuration: settings file in app data; environment variables override for development (`APP_BACKEND_URL` lets the UI target a separately started backend).
- Security: localhost only binding; random port; per-launch token; keys in Credential Manager; provider calls over HTTPS only; no telemetry.

---

## 11. Error handling and logging

- Backend: structured logs to the app log file with rotation; job logs per job. Exceptions in jobs mark the job failed with the message and traceback in the log, never crash the process.
- Frontend: a global error boundary with a "copy diagnostics" button that bundles the last 200 log lines from both sides.
- Sidecar death: the UI detects health failure, shows a blocking dialog with the log path and a restart button.

---

## 12. Testing strategy

- Backend: pytest with a temporary project folder per test; contract tests that validate every response against `openapi.yaml` (schemathesis); dataset tests use 20 real frames copied from `E:\Dev\Yolo\data\raw\ahmadia`; provider tests use recorded responses, live calls only behind an environment flag; a GPU-marked test trains YOLO11n for 1 epoch on 20 images.
- Frontend: Vitest for state and utilities; Playwright end-to-end against the mock server for every screen; one Playwright run against the real backend as the integration gate.
- Definition of done for any task: tests pass, contract unchanged or spec updated in the same change, no lint errors, and the feature is demonstrated through the real UI or API, not only through unit tests.

---

## 13. Delivery plan for a parallel agent run

### 13.1 Sub-projects
| Id | Sub-project | Owns | Depends on |
|---|---|---|---|
| S0 | Contract and scaffolding | `contract/openapi.yaml`, mock server, repo skeleton, CI, lint, backend app shell with health and auth, Tauri shell that boots the sidecar | none |
| S1 | Dataset backend | section 5, `sources`, `images`, `datasets` endpoints | S0 |
| S2 | Annotation UI | section 6 screens against the mock server, then the real backend | S0 |
| S3 | Training backend and registry | section 7, `models`, `jobs` | S0, S1 for datasets |
| S4 | Inference and providers | section 8, `providers`, `query-runs` | S0, S3 for local models |
| S5 | Training and inference UI | training screen, model registry screen, query run screen, job panel, settings | S0, S2 for shared components |
| S6 | Packaging and acceptance | PyInstaller build, Tauri bundle, installer, acceptance script | all |

### 13.2 Waves
- Wave 0: S0 alone. Nothing else starts until the contract is committed and the mock server serves it. Budget: the contract is the single most valuable artifact; spend the effort there.
- Wave 1 in parallel: S1, S2, S3. S2 works against the mock server only.
- Wave 2 in parallel: S4, S5. S2 switches to the real backend for integration.
- Wave 3: S6, then the acceptance run.

Contract changes after Wave 0 go through the goal owner: the change is made in `openapi.yaml` first, the client regenerated, and affected sub-projects notified. No sub-project edits the contract unilaterally.

### 13.3 Agent roles
- Goal owner: keeps the plan, merges, resolves contract changes, runs integration checkpoints. It implements or closely directs S0 because the contract is the foundation, and never implements S1 to S6 itself.
- One implementer agent per sub-project, working in its own git worktree and branch, following plan files under `docs/superpowers/plans/`.
- Reviewer agents for each merge: one correctness review, one contract-conformance review.

### 13.4 Integration checkpoints
1. After Wave 0: UI boots, sidecar starts, health passes, mock server serves the contract.
2. After Wave 1: import the ahmadia sample through the real API; open the editor against the real backend; train 1 epoch from the API.
3. After Wave 2: full flow from the UI: import, label with pre-annotation, create dataset, train, run query with a cloud provider on 5 images, promote.
4. After Wave 3: acceptance run on a clean Windows machine or VM from the installer.

### 13.5 Acceptance run
Scripted in `scripts/acceptance.md` and executed by a person or agent from the installed app:
1. Create project "Ahmadia" with the eight classes.
2. Import `E:\Dev\Yolo\Ahmadia Construction Data`; expect 3299 images, 0 duplicates, grouped into 7 flights.
3. Select the COCO yolo11m import as the pre-annotation model; open 10 images; expect proposals on at least one.
4. Label 30 images; create dataset "v1" split by group; expect train and val folders and a valid data.yaml.
5. Train YOLO11n for 3 epochs; expect progress events, a registered model with metrics.
6. Run the trained model over 50 unlabeled images; review; promote.
7. Run an Anthropic vision query "dump trucks" over 5 images with tiling; expect boxes with provider provenance.
8. Export the model to ONNX; expect a file under `models/`.

---

## 14. Existing assets to reuse

All under `E:\Dev\Yolo`. Read-only unless stated.
- `scripts/prepare_images.py`: import, downscale, dedupe logic to port.
- `ml_backend/model.py`: YOLO to box mapping, class alias handling, the `%5C` path decoding lesson.
- `ahmadia_inventory.csv` and `data/manifests/ahmadia.csv`: ground truth for dataset statistics tests.
- `data/raw/ahmadia/`: 3299 prepared images for tests and acceptance (copy samples, do not modify).
- `models/yolo11n.pt`, `models/yolo11m.pt`: base weights.
- `.venv`: known-good package set (torch 2.14.0+cu130, ultralytics 8.4.154); pin the same versions.
- `README.md`: machine and environment facts.

---

## 15. Open items with defaults

- App name: owner to choose; default folder and identifiers use `machinery-app` until then.
- Aerial augmentation preset contents: start with Ultralytics defaults plus flips in both axes and 90 degree rotations; tune later.
- OpenAI model name: configurable, no default committed here; verify current model names at implementation time.
