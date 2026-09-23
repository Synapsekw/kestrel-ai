# Model library and project kinds (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan runs as **parallel units in separate worktrees**. Each unit brief below is self-contained: it names the files you own, the interfaces you consume and produce, the tests you must write first, and your gate. Don't edit files owned by another unit unless your brief says so.

**Goal:** Move every model into an app-wide library under `%APPDATA%\kestrel-ai\library`, split projects into `train` and `detect` kinds with a server-side kind guard and kind-specific navigation, and adopt existing projects' models into the library.

**Architecture:**
- **Library database and jobs.** A new backend package `app/library/` owns a separate SQLite `library.db`, with its own Alembic migrations. `LibraryHandle` is shaped like a `ProjectHandle` (it has an `id`, a `folder`, `runs_dir` and `session()`), so the existing `JobRunner` can run library jobs without changing.
- **Project kinds.** Projects gain `kind`. A `require_kind` dependency, attached per router or per route, enforces the kind. A route-walk test fails if any project-scoped route has no kind declared.
- **Frontend.** A new app-level Library screen replaces the per-project Models screen. The sidebar and pipeline become kind-specific.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, Ultralytics (loaded lazily), React/TS/Vite, openapi-fetch, vitest/RTL, Playwright + Prism.

**Spec:** `docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md`. This plan covers spec units **L, K, M** (§4, §5, §6). Units D, R, V, A and E are **Plan 2**. Plan 2 is written after the survey timeline (`task/survey-timeline`) merges.

## Global Constraints

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and never hand-edited. Only unit **C** edits the contract. If another unit finds a contract bug, it records the bug in its report and does not edit the contract.
- API keys never appear in the library, project folders, logs or job params.
- Long work is a background job with progress: model import, export, starter acquisition, adoption, move-map.
- The app must start even when the library cannot open: log the failure, set `app.state.library = None`, and have every library-dependent endpoint answer `503 library_unavailable`.
- Nothing from a project's old `models/` folder is ever deleted. The old `model` table stays, read-only.
- Stage by path, never `git add -A`. Commit identity is already pinned in each worktree.
- The backend interpreter is always `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`, run from `<worktree>\backend`. Never create a venv or link into it.
- UI follows `DESIGN.md` and uses only `frontend/src/ui/` primitives and design-token classes (`frontend/scripts/check-tokens.mjs` enforces this). UI copy uses plain words: "model", "library", "training project" and "detection project". There's no machine-learning jargon, and nothing assumes the objects are machinery.
- Migration numbering: the project migration is `0006_project_kind` (revision `"0006"`, down_revision `"0005"`). The survey timeline's `0006_map_captured_on` rebases onto it when it merges; its own spec says it chains onto whatever head is on `main`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Budget

- **Background jobs:** `library_import`, `library_export`, `library_starter` (all library jobs); `train` (registers into the library); `library_adopt` and `map_move` (project jobs).
- **Bounded reads:** the library list is paginated (`clamp_limit`, cursor on `created_at,id`). Usage scans only the recent-projects list (≤20 projects), with one `COUNT` query per table per project. Adoption rewrites ids with one set-based `UPDATE` per table, never by loading rows. No step loads weights into memory except the Ultralytics load-check inside a job.

## Execution DAG

```
C (contract) ──┬── BL (backend library) ──┐
               ├── BK (backend kinds) ────┼── merge BK → BL → FL → FK into integration ── BM + FM ── merge ── X (e2e, docs) ── main
               ├── FL (frontend library) ─┤
               └── FK (frontend kinds) ───┘
```

- **Batch 1:** C, alone. It is committed on the integration branch `task/tds-integration`.
- **Batch 2:** BL, BK, FL and FK in parallel, each in its own worktree branched from the integration branch after C.
- **Merge wave 1:** into integration, serialized, in the order BK → BL → FL → FK. Each merge is followed by the gates for the side it touched.
- **Batch 3:** BM and FM in parallel, branched from integration after wave 1.
- **Merge wave 2:** BM, then FM.
- **Batch 4:** X, on the integration worktree itself. Then the full gate, then `scripts\finish-task.ps1` merges integration into `main`.
- **Critical path:** C → BL → merge → BM → X.

Worktrees live at `.claude/worktrees/tds-<unit>` on branches `task/tds-<unit>`. The integration worktree is `.claude/worktrees/train-detect-spec` (branch renamed to `task/tds-integration`).

---

## Unit C — Contract

**Owns:** `contract/openapi.yaml`, `contract/client/schema.d.ts` (generated), `contract/fixtures/**` if examples need it, `backend/tests/test_contract.py` **only** for adding new routes to any explicit allow/skip lists it keeps (read it first).

**Produces:** the schema names below. Every other unit codes against them verbatim.

- [ ] **Step 1: Read** `contract/openapi.yaml`. Note the conventions it uses: error envelope, `JobRef`, pagination (`items`, `next_cursor`), examples on every schema, and the `operationId` style.
- [ ] **Step 2: Remove** these paths: `/projects/{projectId}/models`, `/projects/{projectId}/models/import`, `/projects/{projectId}/models/train`, `/projects/{projectId}/models/{modelId}`, `/projects/{projectId}/models/{modelId}/export`, `/projects/{projectId}/models/{modelId}/artifacts/{artifact}`, `/projects/{projectId}/models/import-starter`, `/projects/{projectId}/models/acquire-starter`. Remove the `Model`, `ModelPage` and `ModelImport` schemas; keep `ModelMetrics`, `ClassMetrics`, `ExportRequest`, `TrainRequest`. Keep `GET /starter-models` unchanged.
- [ ] **Step 3: Add the schemas.**

```yaml
ProjectKind: {type: string, enum: [train, detect]}
# ProjectCreate gains required `kind: ProjectKind`; ProjectOut gains required `kind: ProjectKind`.
LibraryModel:
  required: [id, name, notes, supplier, task, format, origin, state, class_names, class_aliases,
             provenance, hyperparameters, metrics, exports, artifacts, train_gsd_cm, sha256, created_at]
  properties:
    id: {type: string}
    name: {type: string}
    notes: {type: string}
    supplier: {type: [string, "null"]}
    task: {type: string, enum: [detect, obb]}
    format: {type: string, enum: [pt, onnx]}
    origin: {type: string, enum: [trained, imported, starter]}
    state: {type: string, enum: [ready, unavailable]}
    class_names: {type: array, items: {type: string}}
    class_aliases: {type: object, additionalProperties: {type: string}}
    provenance: {$ref: ModelProvenance}
    hyperparameters: {type: object, additionalProperties: true}
    metrics: {oneOf: [{$ref: ModelMetrics}, {type: "null"}]}
    exports: {type: object, additionalProperties: {type: string}}      # {"onnx": "exports/weights.onnx"}
    artifacts: {type: object, additionalProperties: {type: string}}    # keys: results_csv, confusion_matrix, pr_curve
    train_gsd_cm: {type: [number, "null"]}
    sha256: {type: string}
    created_at: {type: string, format: date-time}
ModelProvenance:   # every field optional + nullable; a snapshot taken at registration, never a live link
  properties: {project_id, project_name, project_folder, dataset_id, dataset_name, run_id,
               base_model_id, base_model_name, source_file}   # all {type: [string, "null"]}
LibraryModelPage: {items: [LibraryModel], next_cursor: string|null}
LibraryModelImport:
  required: [name, weights_path]
  properties: {name: {minLength: 1}, weights_path: {minLength: 1}, class_aliases: {object of string, default {}}, supplier: [string, "null"]}
LibraryModelPatch:  # all optional; name minLength 1
  properties: {name, notes, supplier ([string,"null"]), class_aliases}
ModelUsage:
  required: [projects]
  properties:
    projects: {type: array, items: {required: [project_id, name, folder, preannotation, query_runs, map_runs],
      properties: {project_id: string, name: string, folder: string, preannotation: boolean, query_runs: integer, map_runs: integer}}}
LibraryStatus: {required: [available, root, error], properties: {available: boolean, root: string, error: [string, "null"]}}
StarterAcquire: {properties: {name: [string, "null"]}}
AdoptionStatus:
  required: [pending, adopted, missing, job_id]
  properties:
    pending: integer
    adopted: integer
    missing: {type: array, items: {required: [old_model_id, name, error], properties: {old_model_id: string, name: string, error: string}}}
    job_id: [string, "null"]
MapMoveRequest: {required: [target_project_id], properties: {target_project_id: string}}
```

- [ ] **Step 4: Add the paths.** All are under the existing `/api/v1` server prefix and use the existing bearer security.

| Method + path | operationId | Request | Responses |
| --- | --- | --- | --- |
| `GET /library/status` | `getLibraryStatus` | — | 200 `LibraryStatus` |
| `GET /library/models` | `listLibraryModels` | query `task?` (detect\|obb), `limit?` (1–1000), `cursor?` | 200 `LibraryModelPage`, 503 |
| `POST /library/models/import` | `importLibraryModel` | `LibraryModelImport` | 202 `JobRef`, 503 |
| `GET /library/models/{modelId}` | `getLibraryModel` | — | 200 `LibraryModel`, 404, 503 |
| `PATCH /library/models/{modelId}` | `updateLibraryModel` | `LibraryModelPatch` | 200 `LibraryModel`, 404, 503 |
| `DELETE /library/models/{modelId}` | `deleteLibraryModel` | — | 204, 404, 503 |
| `GET /library/models/{modelId}/usage` | `getLibraryModelUsage` | — | 200 `ModelUsage`, 404, 503 |
| `GET /library/models/{modelId}/artifacts/{artifact}` | `getLibraryModelArtifact` | artifact enum `results_csv, confusion_matrix, pr_curve` | 200 (text/csv or image/png), 404, 503 |
| `POST /library/models/{modelId}/export` | `exportLibraryModel` | `ExportRequest` | 202 `JobRef`, 404, 503 |
| `POST /library/starters/{key}/acquire` | `acquireStarterModel` | `StarterAcquire` | 202 `JobRef`, 404, 503 |
| `GET /library/jobs` | `listLibraryJobs` | query `state?`, `type?`, `limit?`, `cursor?` | 200 `JobPage`, 503 |
| `GET /library/jobs/{jobId}` | `getLibraryJob` | — | 200 `Job`, 404, 503 |
| `GET /library/jobs/{jobId}/log` | `getLibraryJobLog` | same query as the project job log | 200 `JobLog`, 404, 503 |
| `POST /library/jobs/{jobId}/cancel` | `cancelLibraryJob` | — | 200 `Job`, 404, 503 |
| `POST /projects/{projectId}/train` | `trainModel` | `TrainRequest` (`base_model_id` is now a **library** model id) | 202 `JobRef`, 404, 409, 422 |
| `GET /projects/{projectId}/adoption` | `getModelAdoption` | — | 200 `AdoptionStatus`, 404 |
| `POST /projects/{projectId}/adoption/retry` | `retryModelAdoption` | — | 202 `JobRef`, 404, 409 |
| `POST /projects/{projectId}/maps/{mapId}/move` | `moveMapToProject` | `MapMoveRequest` | 202 `JobRef` (job lives in the **target** project), 404, 409 |

- Add a 409 response with code `wrong_project_kind` to every project-scoped operation whose kind is restricted (see unit BK's table).
- Document the error codes `wrong_project_kind` (409), `library_unavailable` (503) and `model_unavailable` (409) in the error-code description or enum the contract already keeps.
- Update the descriptions of `QueryRunCreate.model_id`, `MapRunCreate.model_id`, `ProjectUpdate.preannotation_model_id` and `PreannotateRequest.model_id` (if present) to "a library model id".
- `Job.project_id` description: "the project id, or `library` for library jobs".

- [ ] **Step 5: Examples.** Every new schema needs an example that passes Spectral. Use `task: detect`, `format: pt`, `origin: trained`, `state: ready` and realistic provenance. The Prism mock serves these to the e2e suite, so `GET /library/models` must return at least one model, and `ProjectOut` must return `kind: train`.
- [ ] **Step 6: Generate and check.** Run `pnpm -C contract generate`, then `pnpm -C contract check`. Expected: lint clean, no diff after generate.
- [ ] **Step 7: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts
git commit -m "feat(contract): model library, project kinds, adoption and map move"
```

Don't run the backend gate here. `test_contract.py` will fail until BL and BK merge; that is expected on the integration branch.

---

## Unit BL — Backend library

**Owns:** new `backend/app/library/**`, `backend/app/training/{registry.py,router.py,jobs.py,starter.py,starter_router.py,starter_download.py,schemas.py}`, `backend/app/providers/factory.py`, the model-lookup lines in `backend/app/inference/{service.py,jobs.py}` and `backend/app/maps/jobs_detect.py`, `backend/app/jobs/runner.py` (only to add `library` wiring), `backend/app/main.py` lifespan (library open plus startup sweep), `backend/app/api.py` (router includes only), and new tests `backend/tests/test_library_*.py`. It updates the existing tests that hit `/projects/{id}/models` (`test_registry.py`, `test_starter.py`, `test_training_jobs.py`, `test_preannotate.py`, `test_query_runs.py`, `test_maps_detect.py`, and others found by grep) to use the library.

**Consumes:** unit C's schemas.

**Produces** (exact names; BM and later units depend on them):

```python
# app/library/paths.py
def library_root(data_dir: Path) -> Path: ...          # data_dir / "library"

# app/library/db.py
class LibraryBase(DeclarativeBase): ...
class LibraryModel(LibraryBase):                       # table "library_model"
    id: str; name: str; notes: str; supplier: str | None
    task: str; format: str; origin: str
    weights_path: str                                   # relative to library root, posix: "models/<slug>-<id8>/weights.pt"
    class_names: list; class_aliases: dict; provenance: dict
    hyperparameters: dict; metrics: dict | None
    exports: dict; artifacts: dict                      # values relative to library root
    train_gsd_cm: float | None; sha256: str (unique index); created_at: datetime
# library.db also has a table "job" with exactly the columns of app.db.models.Job, so the
# existing Job ORM class and JobRunner work against a library session unchanged.

# app/library/handle.py
class LibraryHandle:
    id = "library"
    folder: Path; runs_dir: Path; models_dir: Path      # root, root/"runs", root/"models"
    def session(self) -> ContextManager[Session]: ...   # commit/rollback like ProjectHandle.session
def open_library(data_dir: Path) -> LibraryHandle: ...  # mkdirs, alembic upgrade head (own migrations dir)
def get_library(request: Request) -> LibraryHandle: ... # 503 AppError("library_unavailable", ...) when app.state.library is None

# app/library/service.py
def sha256_file(path: Path) -> str: ...
def read_checkpoint(weights: Path) -> tuple[str, list[str]]: ...   # (task, class_names); lazy ultralytics import
def add_model(lib, *, source_weights: Path, name: str, origin: str, task: str, class_names: list[str],
              class_aliases: dict | None = None, provenance: dict | None = None, metrics: dict | None = None,
              hyperparameters: dict | None = None, artifacts: dict[str, Path] | None = None,
              exports: dict[str, Path] | None = None, supplier: str | None = None,
              train_gsd_cm: float | None = None, sha256: str | None = None) -> LibraryModel: ...
    # copies weights (and artifacts/exports) into models/<slug>-<id8>/; a sha256 already present ->
    # AppError("already_exists", "...", 409, {"model_id": existing.id})
def find_by_sha(lib, sha256: str) -> LibraryModel | None: ...
def list_models(lib, limit: int | None, cursor: str | None, task: str | None = None) -> tuple[list[LibraryModel], str | None]: ...
def get_model(lib, model_id: str) -> LibraryModel: ...              # not_found("model", id)
def update_model(lib, model_id: str, **fields) -> LibraryModel: ... # name, notes, supplier, class_aliases
def delete_model(lib, model_id: str) -> None: ...                  # row + its models/<dir> (shutil.rmtree on that dir only)
def weights_file(lib, row: LibraryModel) -> Path: ...
def state_of(lib, row: LibraryModel) -> str: ...                   # "ready" | "unavailable" (weights file missing)
def require_ready(lib, model_id: str) -> LibraryModel: ...         # 409 AppError("model_unavailable", ...)
def set_export(lib, model_id: str, fmt: str, path: Path) -> LibraryModel: ...
def usage(lib, registry: ProjectRegistry, model_id: str) -> list[dict]: ...  # ModelUsage.projects

# app/library/schemas.py
class LibraryModelOut(BaseModel): ...   # from_row(row, state) matching contract LibraryModel
# plus LibraryModelPage, LibraryModelImport, LibraryModelPatch, ModelUsage, LibraryStatus, StarterAcquire

# job types (app/library/jobs.py), params persisted in library.db:
#   "library_import"  {name, weights_path, class_aliases, supplier} -> {"model_id"}
#   "library_export"  {model_id, format, imgsz, half}               -> {"format", "path"}
#   "library_starter" {key, name}                                    -> {"model_id"}  (download if needed, then add_model origin="starter")

# JobRunner gains attribute `library: LibraryHandle | None` (wired in lifespan, like `keys`).
# providers/factory.get_provider: the `handle` parameter is replaced by `weights: Path | None`;
#   model_row is a LibraryModel. Callers pass weights=service.weights_file(lib, row).
```

**Behaviour to implement:**

1. **Lifespan** (`main.py`): `app.state.library` is set by `open_library(settings.data_dir)` inside `try`. On an exception, log it and set `app.state.library = None` and `app.state.library_error = str(e)`. After `jobs.start()`, when the library is open, run `app.jobs.startup.sweep_orphans(app.state.library, app.state.jobs)` in its own `try`. Set `app.state.jobs.library = app.state.library`.
2. **Router** `app/library/router.py`: implements unit C's `/library/*` paths, plus `POST /projects/{projectId}/train` (it moves out of `training/router.py`, which is deleted along with `starter_router.project_router`). `GET /starter-models` stays where it is.
3. **Train job:**
   - `base_model_id` is a library id. Base weights come from `weights_file(lib, require_ready(lib, id))`.
   - On success it calls `add_model(origin="trained", task="detect"`, or the dataset's task if the dataset records OBB, `class_names=[dataset class names], metrics=result.final_metrics, hyperparameters=..., artifacts={results_csv, confusion_matrix, pr_curve}`, and provenance `{project_id, project_name, project_folder, dataset_id, dataset_name, run_id: job_id, base_model_id, base_model_name}`).
   - It returns `{"model_id": <library id>, "metrics": ...}`. The router answers 404 for an unknown base model and 409 for an unavailable one, before the job is queued.
4. **Import** (`POST /library/models/import`):
   - Before queueing, the router validates that `weights_path` is absolute, `.pt` and an existing file, and answers 404 otherwise, with the same wording and the same contract rationale as today's `registry.import_model`.
   - The job hashes the file and fails with a readable `JobFailure` if the hash is a duplicate, naming the existing model.
   - It then copies the file, runs `read_checkpoint` (on failure it deletes the copy and fails with `JobFailure("… is not a loadable YOLO checkpoint: …")`), and calls `add_model(origin="imported", provenance={"source_file": weights_path})`.
5. **Callers:**
   - `inference/service.py` (the query-run model name, and pre-annotation), `inference/jobs.py` and `maps/jobs_detect.py` resolve models through `app.library.service.get_model`.
   - They get the library from `request.app.state.library` (routers) or `ctx.runner.library` (jobs).
   - When the library is `None`, a run with `kind=local_model` answers `503 library_unavailable` at creation.
   - Remove `training/registry.py`'s model functions. Keep `get_dataset`, `slug` and `read_class_names` only if they are still used.
6. **Starter models:** `training/starter.py`'s `import_starter` becomes `add_model(origin="starter")` into the library. `starter_download.run_acquire_starter` becomes the `library_starter` job, which takes `ctx.project` as the library handle. The aliases come from `DEFAULT_ALIASES` without project filtering: library models are standalone, and the project mapping happens at run time.
7. **Usage** (`GET /library/models/{id}/usage`): for each project on `registry.recent()` whose folder still has `project.db`:
   - open it with `remember=False`
   - count `QueryRun` and `MapRun` rows with that `model_id`
   - check `Project.preannotation_model_id`
   - include only projects where one of those is non-zero or true
   - skip, with a log line, any project that fails to open.

**Tests to write first** (`backend/tests/test_library_service.py`, `test_library_api.py`, `test_library_jobs.py`). Stub `read_checkpoint` to `("detect", ["excavator","dump_truck"])` the way `test_registry.py` stubs `read_class_names`, so no test loads torch. The one real-checkpoint test is skipped when `yolo11n.pt` is absent, as today.

- [ ] `open_library` creates `library.db` with the tables `library_model` and `job`; a second open is a no-op.
- [ ] `add_model` copies the weights to `models/<slug>-<id8>/weights.pt` and returns a row whose `weights_path` is posix and relative. A second `add_model` with the same sha raises a 409 whose `details.model_id` is the first model's id.
- [ ] `state_of` returns `unavailable` after the weights file is deleted, and `require_ready` then raises a 409 with code `model_unavailable`.
- [ ] `delete_model` removes only that model's folder; a sibling model's folder survives.
- [ ] API: `POST /library/models/import` with a relative path → 404. With a real fake file → 202. `wait_job` on the library job (the `/library/jobs/{id}` poll) → succeeded, and `GET /library/models` lists it with `state: ready`.
- [ ] API: `PATCH` a name, notes or supplier → 200; an empty name → 422.
- [ ] API: `GET /library/status` → `available: true`. With `app.state.library = None` → `available: false`, and `/library/models` answers 503 with code `library_unavailable`.
- [ ] Startup: when `open_library` raises (monkeypatched), the app still starts and `/health` answers 200.
- [ ] Train job (the existing fake trainer from `tests/fake_worker.py` / `test_training_jobs.py`): after success the library has one `origin: trained` model with provenance `project_id`, `dataset_name` and `run_id` equal to the job id.
- [ ] A query run and a map run with a library model id create their provider with `weights == weights_file(...)`. Assert through the existing provider fakes.
- [ ] Usage: a project whose `preannotation_model_id` is the model → listed with `preannotation: true`.
- [ ] Orphan sweep: a `running` library job row left in `library.db` becomes `failed` at app start.

- [ ] **Gate:** `ruff check .`, `ruff format --check .`, `pytest -q`. The whole backend suite must pass except `test_contract.py` failures caused solely by BK-owned paths (`kind`, adoption, move); list those failures in your report. Commit in small steps, one per behaviour group above.

---

## Unit BK — Backend project kinds

**Owns:**
- the new `backend/app/projects/kinds.py`
- `backend/app/projects/{service.py,schemas.py,router.py}`
- `backend/app/appdata.py`
- `backend/app/db/models.py` (the `Project.kind` and `ModelAdoption` model only)
- the new migration `backend/app/db/migrations/versions/0006_project_kind.py`
- `backend/app/api.py`: the guard wiring
- `kind=` route dependencies in `datasets/router.py`, `inference/router.py`, `maps/router.py` and `project_agent/router.py`
- new tests `backend/tests/test_project_kinds.py`, plus updates to `conftest.py`'s `project` fixture (add `"kind": "train"`) and to any test that posts `/projects` without a kind

**Produces:**

```python
# db/models.py
class Project: kind: Mapped[str] = mapped_column(String, default="train", server_default="train")
class ModelAdoption(Base):                 # table "model_adoption"
    old_model_id: str (pk); library_model_id: str | None
    status: str                            # "adopted" | "missing" | "failed"
    error: str | None; updated_at: datetime
# migration 0006: add project.kind NOT NULL server_default 'train'; create model_adoption. Never rewrites rows.

# projects/kinds.py
KIND_ATTR = "__kestrel_kind__"
def require_kind(write: tuple[str, ...], read: tuple[str, ...] | None = None) -> Callable:
    """FastAPI dependency. GET/HEAD are checked against `read` (defaults to `write`), other methods
    against `write`. Wrong kind -> AppError("wrong_project_kind", "<plain sentence>", 409,
    {"kind": <project kind>, "allowed": [...]}). The returned callable carries KIND_ATTR=(write, read)."""
ANY_KIND = ("train", "detect")
def project_kind(handle: ProjectHandle) -> str: ...

# appdata.AppData.remember(project_id, name, folder, kind="train")   recent entries gain "kind"
# ProjectRegistry.create(name, folder, classes, kind)                 kind required
# ProjectCreate.kind: Literal["train","detect"] (required); ProjectOut.kind
```

**Kind table.** Wire it exactly like this: router-level `dependencies=[Depends(require_kind(...))]` where the whole router shares a rule, and route-level where it doesn't.

| Routes | write | read |
| --- | --- | --- |
| `datasets/router.py`: `/datasets`, `/datasets/{id}`, `/datasets/{id}/stats` (all methods) | train | train |
| `datasets/router.py`: images, sources, boxes | any | any |
| `inference/router.py`: `/images/{id}/preannotate` | train | train |
| `inference/router.py`: `/query-runs*` | detect | any |
| `maps/router.py`: everything except `move` | detect | any |
| `maps/router.py`: `/maps/{id}/move` (added by BM) | train | train |
| `/projects/{id}/train` (the BL router) | train | train |
| `/projects/{id}/adoption*` (added by BM) | train | train |
| `project_agent/router.py` | train | train |
| `jobs/router.py`, `exports/router.py`, `projects/router.py`'s `/{projectId}*` routes | any | any |

BL adds the `/train` route. BK can't see it until merge, so BK writes the route-walk test to cover it by pattern. After merge the test fails until that route carries its guard, and the merge step fixes it: one line in the BL router, `dependencies=[Depends(require_kind(("train",)))]`.

**Tests to write first** (`backend/tests/test_project_kinds.py`):

- [ ] Migration: open a project folder created at revision `0005`, e.g. by copying the fixture DB, or by `alembic downgrade` in a tmp copy. After upgrade, `project.kind == "train"` and `model_adoption` exists.
- [ ] `POST /projects` without `kind` → 422. With `kind: detect` → 201 and `kind: detect`. `GET /projects` lists `kind`, and `recent_projects.json` stores it.
- [ ] Guard, in a detect project: `POST /datasets` → 409 with code `wrong_project_kind`; `POST /images/{id}/preannotate` → 409.
- [ ] Guard, in a train project: `POST /query-runs` → 409; `GET /query-runs` → 200 (past detections are read-only); `POST /maps` → 409; `GET /maps` → 200.
- [ ] **Route walk:** every route in `app.routes` whose path starts with `/api/v1/projects/{projectId}` has a dependency, found recursively through `route.dependant.dependencies`, whose `call` carries `KIND_ATTR`. The failure message lists the unguarded paths.

- [ ] **Gate:** as for BL. Expected contract failures (BL's paths) are listed in your report.

---

## Unit FL — Frontend library

**Owns:**
- new `frontend/src/library/**`, which absorbs the contents of `frontend/src/models/**`. Move the components (`ModelTable`, `ModelDetail`, `ImportModelForm`, `StarterModels`, `ExportButtons`, `ModelArtifacts`, `TrainingCurve`, `aliases.ts`) with `git mv` and adapt them.
- new `frontend/src/api/library.ts`, replacing `api/models.ts` and `api/starterModels.ts`'s project-scoped functions
- the model pickers in `train/**` + `screens/TrainScreen.tsx`, `query/**` + `screens/QueryScreen.tsx`, `maps/NewRunDialog.tsx`, `settings/PreannotationSection.tsx`, `screens/ExportScreen.tsx` (drop its model export section and link to the Library instead), `app/useProjectProgress.ts` and `api/project.ts` (`fetchModels` → library), `jobs/jobLabels.ts` (links → `/library?model=<id>`), `app/nextStep.ts` (the `models === 0` step → `/library`), `agent/**` (`acquireStarterModel` → the library call)
- the tests beside each of those files
- `frontend/e2e/models.spec.ts`, renamed to `library.spec.ts`

**Does not own:** `routes.tsx`, `app/Sidebar.tsx`, `app/pipeline.ts`, `app/Header.tsx`, `screens/ProjectsScreen.tsx` (all FK). FL exports `LibraryScreen` from `frontend/src/library/LibraryScreen.tsx` as a default-less named export: `export function LibraryScreen()`. FK routes `/library` to it. FL deletes `screens/ModelsScreen.tsx` and its test. FK deletes the `/p/:projectId/models` route; after merge the build is green again.

**Produces:**

```ts
// api/library.ts
export type LibraryModel = components["schemas"]["LibraryModel"];
export function fetchLibraryModels(api: ApiClient, query?: { task?: "detect" | "obb" }): Promise<LibraryModel[]>; // collectPages
export function fetchLibraryModel(api: ApiClient, modelId: string): Promise<LibraryModel>;
export function importLibraryModel(api: ApiClient, body: LibraryModelImport): Promise<Job>;
export function updateLibraryModel(api: ApiClient, modelId: string, patch: LibraryModelPatch): Promise<LibraryModel>;
export function deleteLibraryModel(api: ApiClient, modelId: string): Promise<void>;
export function fetchModelUsage(api: ApiClient, modelId: string): Promise<ModelUsage>;
export function exportLibraryModel(api: ApiClient, modelId: string, body: ExportRequest): Promise<Job>;
export function acquireStarter(api: ApiClient, key: string, name?: string): Promise<Job>;
export function fetchLibraryJobs(api: ApiClient, query?: { state?: string }): Promise<Job[]>;
export function fetchLibraryJob(api: ApiClient, jobId: string): Promise<Job>;
export function cancelLibraryJob(api: ApiClient, jobId: string): Promise<Job>;
export function fetchLibraryStatus(api: ApiClient): Promise<LibraryStatus>;
export function libraryArtifactUrl(baseUrl: string, token: string, modelId: string, artifact: Artifact): string;
export function trainModel(api: ApiClient, projectId: string, body: TrainRequest): Promise<Job>; // POST /projects/{id}/train
// library/useLibraryModels.ts
export function useLibraryModels(task?: "detect" | "obb"): { models: LibraryModel[]; loading: boolean; error: string | null; unavailable: boolean; reload(): void };
// library/useLibraryJobs.ts: polls /library/jobs every 2 s while any is queued|running, upserts them into
// the jobs store (so JobsButton counts them), and calls onFinished(job) once per job that reaches a terminal state.
```

**Library screen** (`/library`), following `DESIGN.md`. The layout mirrors today's Models screen: a list on the left and the detail on the right.
- **Header actions:** "Import a model file" opens a Disclosure containing `ImportModelForm` (`.pt` only), which adds a supplier field. "Add a starter model" opens `StarterModels`, now library-scoped.
- **Filters:** task (All / Boxes / Rotated boxes) and origin (All / Trained / Imported / Starter).
- **Row:** name, origin pill, task, class count, and an `unavailable` warning pill when that applies.
- **Detail:**
  - provenance, rendered as "Trained in *<project_name>* on *<dataset_name>*", or "Imported from *<file>*" plus the supplier
  - metrics and training curve
  - artifacts, class names, aliases (editable)
  - notes and supplier (editable, saved with `PATCH`)
  - export buttons
  - **Delete**: fetches usage first. If any project uses the model, a warn `Alert` lists those projects and says past results stay readable; a second click confirms.
- **Unavailable library** (`status.available=false`): a blocking `Alert` with the error text, plus a "Reveal folder" button that calls the existing `/projects/{id}/reveal`-style helper if one fits; otherwise the path is shown in mono.
- **Job progress:** import, export and starter jobs show inline `Progress` rows from `useLibraryJobs`. On success, the list reloads and selects the new model (`?model=<id>`).

**Pickers:** every picker lists library models via `useLibraryModels()`, and the option group label becomes "Models in your library". The "Set as pre-annotation model" action on the Library detail is removed, because the library is app-level; pre-annotation is chosen in Project settings, where the picker lists library models.

**Tests first** (vitest, `fakeClient`), replacing `ModelsScreen.test.tsx`, `ModelDetail.test.tsx` and `StarterModels.test.tsx`:
- [ ] `LibraryScreen` renders models from `GET /library/models`, and filtering by origin hides the others.
- [ ] Import submits `POST /library/models/import` with `{name, weights_path, class_aliases, supplier}`. A 202 job then shows progress, and success reloads the list.
- [ ] Delete with usage → the warn alert names the project, and only the second click sends `DELETE`.
- [ ] `status.available=false` → the blocking alert, and no list request is made.
- [ ] TrainScreen sends `POST /projects/{id}/train` with a library `base_model_id`.
- [ ] QueryScreen, NewRunDialog and PreannotationSection list library models.
- [ ] `useLibraryJobs` upserts library jobs, and the JobsButton count includes them.
- [ ] e2e `library.spec.ts`: `/library` lists the mock's model, and opening one shows its provenance.

- [ ] **Gate:** `pnpm -C frontend lint`, `pnpm -C frontend test`, `pnpm -C frontend build`. The build may fail only on the missing `/library` route or the dangling `ModelsScreen` import in `routes.tsx` (FK's file). Say so in your report. Don't run e2e; X does.

---

## Unit FK — Frontend project kinds

**Owns:** `frontend/src/routes.tsx`, `app/Sidebar.tsx`, `app/pipeline.ts`, `app/Header.tsx`, `app/Shell.tsx`, `screens/ProjectsScreen.tsx`, `screens/HomeScreen.tsx` (kind-aware copy only), new `app/useProjectKind.ts`, new `app/KindRoute.tsx`, new `screens/PastDetectionsScreen.tsx`, `screens/QueryScreen.tsx` and `screens/MapsScreen.tsx` (**only** the `readOnly` prop plumbing; FL owns their pickers, and the merge resolves any overlap), their tests, and `frontend/e2e/projects.spec.ts` / `navigation`-type specs that assert sidebar entries.

**Produces:**

```ts
// app/pipeline.ts
export type StepId = "images" | "label" | "datasets" | "train" | "detect" | "maps" | "review" | "export";
export const TRAIN_STEPS: StepId[] = ["images", "label", "datasets", "train", "review", "export"];
export const DETECT_STEPS: StepId[] = ["images", "detect", "maps", "review", "export"];
export function stepStates(projectId: string, kind: ProjectKind, p: ProjectProgress): Step[];
//   detect lock: p.models === 0 -> "Add a model to the library first" (links to /library)
//   maps (detect only): never locked; review lock unchanged; labels: detect "Sources" is the images step
// app/useProjectKind.ts
export function useProjectKind(projectId: string | undefined): ProjectKind | null;  // from useProject
// app/KindRoute.tsx
export function KindRoute(props: { allow: ProjectKind[]; children: ReactNode }): JSX.Element;
//   wrong kind -> <Navigate to={`/p/${projectId}`} replace /> ; loading -> Skeleton
```

**Behaviour:**

1. **ProjectsScreen:**
   - The single create form becomes a `Segmented` control with two options, "Training project" and "Detection project", above Name. The submit body carries `kind`.
   - A detection project hides the class editor and starts with an empty class list; its classes are filled in by the first run (Plan 2). A training project keeps the class editor and the setup agent.
   - Each list card shows a kind `Pill`: "Training" or "Detection".
   - A filter `Segmented` sits above the list: All / Training / Detection.
2. **Sidebar:**
   - App-level entries: Projects, **Library** (`/library`, icon `models`), then App settings in the footer.
   - Inside a project, show the name label, Home, and the kind's steps (from `stepStates`), then the divider.
   - Below the divider: for train projects, **Past detections** (`/p/:id/past`, shown only when the progress store reports `queryRuns > 0 || maps > 0`), then Project settings. For detect projects, Project settings only, because Maps is a step for them.
   - The Models entry is removed.
3. **Routes:**
   - Add `library` → `<LibraryScreen />` (from FL) and `p/:projectId/past` → `<PastDetectionsScreen />`.
   - Remove `p/:projectId/models`.
   - Wrap with `KindRoute`:
     - label, edit, datasets, train → `["train"]`
     - query, maps, maps/:mapId → `["detect"]`
     - past → `["train"]`
     - data, review, export, settings, home → both
4. **PastDetectionsScreen:**
   - Two sections: "Detection runs", which renders `QueryScreen` content with `readOnly`, and "Maps", which renders the maps list and viewer with `readOnly`.
   - `readOnly` hides every create, run, label, zone, delete and promote control, and shows an info `Alert`: "Detections made before training and detection were split. New detections belong in a detection project."
   - Export buttons stay.
5. **Header:** `SCREEN` gains `past: "Past detections"`, and `screenName` returns `"Library"` for `/library`.
6. **Progress:** `ProjectProgress` gains `maps: number` (from `GET /maps`, count only); BM's banner needs it too.

**Tests first:**
- [ ] ProjectsScreen: choosing Detection sends `kind: "detect"` and hides the class editor. The list shows kind pills, and the filter works.
- [ ] Sidebar: a train project shows Images, Label, Datasets, Train, Review, Export and no Detect. A detect project shows Images, Detect, Maps, Review, Export and no Label. Library appears at app level in both.
- [ ] `KindRoute`: `/p/<detect>/datasets` redirects to Home.
- [ ] `PastDetectionsScreen` with `readOnly` renders no "New run" button.
- [ ] `stepStates` unit tests for both kinds.

- [ ] **Gate:** lint, test, build. The build may fail only on the missing `library/LibraryScreen` import. Report it.

---

## Merge wave 1 (serialized, integration worktree)

In `.claude/worktrees/train-detect-spec` on `task/tds-integration`, one branch at a time, in the order **BK, BL, FL, FK**:

- [ ] `git merge --no-ff task/tds-<unit>`, resolving conflicts in favour of both sides' intent. Known overlaps:
  - `api.py`, `main.py`, `conftest.py` (BK/BL)
  - `QueryScreen`/`MapsScreen` (FL pickers vs FK readOnly)
  - `routes.tsx` (FK) vs FL's deleted `ModelsScreen`
- [ ] After BL: add `require_kind(("train",))` to the `/projects/{id}/train` route if it's still unguarded. Then run the backend gate. Expected: fully green, including `test_contract.py`.
- [ ] After FK: the frontend gate (lint, test, build). Expected: green.
- [ ] Fix whatever integration breaks, committing each fix separately with a message naming the two units.

---

## Unit BM — Backend adoption and move-map

**Owns:** new `backend/app/library/adoption.py`, the adoption routes (in `app/library/router.py` or a new `app/library/adoption_router.py`), the `project_opened` step in `main.py`, new `backend/app/maps/move.py` plus the `/maps/{mapId}/move` route in `maps/router.py`, and the tests `test_library_adoption.py` and `test_maps_move.py`.

**Consumes:** `add_model`, `find_by_sha`, `sha256_file`, `ModelAdoption`, `require_kind`, `Project.kind`.

**Produces:** `def pending_adoptions(handle) -> list[Model]`, `def adopt_project_models(ctx) -> dict` (job type `"library_adopt"`, a project job) and `def adoption_status(handle) -> dict` (AdoptionStatus). There is also job type `"map_move"`, a job in the **target** project with params `{source_project_id, map_id}`.

**Behaviour:**

1. **On open:** `project_opened` gains the step `("model adoption", lambda: adoption.submit_if_pending(handle, runner))`. It only submits when the project kind is `train`, `pending_adoptions` is non-empty, no `library_adopt` job is queued or running, and `runner.library` is not `None`.
2. **Adopting each pending `Model` row** (`id` not in `model_adoption` with status `adopted`):
   - `src = handle.folder / row.weights_path`. If missing, upsert `ModelAdoption(status="missing", error="weights file not found: <rel>")` and continue.
   - Compute the sha. If `find_by_sha` finds a model, use it. Otherwise call `add_model`:
     - `origin`: `"trained"` when `row.kind == "trained"`, else `"imported"`
     - `task`: `"detect"` (read with `read_checkpoint` only if `class_names` is empty)
     - `class_names=row.class_names`, `class_aliases`, `metrics`, `hyperparameters`
     - `artifacts`: from `row.artifacts`, resolved against `handle.folder`, keeping only existing files
     - `exports`: likewise
     - `provenance`: project id, name and folder; the dataset id plus `dataset_name` looked up from `Dataset`; `run_id`; `base_model_id`
   - Upsert `ModelAdoption(status="adopted", library_model_id=...)`.
   - Any other exception becomes `status="failed"` with the message, and the loop moves on.
   - Report `ctx.progress(i/n, "Adopting <name>")`.
3. **Rewriting ids:** after the loop, in one transaction, for each adopted pair `(old, new)` run set-based `UPDATE`s on `project.preannotation_model_id`, `query_run.model_id`, `map_run.model_id` and `box.model_id` where the value equals `old`. The job is safe to re-run: adopted rows are skipped, and ids already rewritten match nothing.
4. **Adoption routes:** `GET /projects/{id}/adoption` → `adoption_status`. `POST /adoption/retry` deletes the `missing` and `failed` rows and submits the job; it answers 409 when one is already running. Guard both with `require_kind(("train",))`.
5. **Move map:** `POST /projects/{projectId}/maps/{mapId}/move` checks the target:
   - It must exist, via `registry.get`. A target that isn't `detect` → 409 `wrong_project_kind`.
   - The source must be `train`.
   - It submits `map_move` in the target project.

   The job copies:
   - the `GeoMap` row (same id; a new DB), its `maps/<mapId>/` derived folder (overviews and tiles) under the target's `maps_dir`, and the source file reference (`source_path` is absolute to the operator's file, so it's kept as is)
   - its `MapZone` and `MapLabel` rows, and `captured_on` if the column exists

   It doesn't copy runs. It reports progress by bytes copied. If the map id already exists in the target, it fails with a readable `JobFailure`.

**Tests first:**
- [ ] A train project with two old `Model` rows, one with weights and one missing. The job adopts one and marks the other missing. `preannotation_model_id`, a `QueryRun`, a `MapRun` and a `Box` pointing at the old id now point at the library id. Running the job again changes nothing and adds no library model.
- [ ] Two projects holding the same weights file end up sharing one library model (a sha hit).
- [ ] `submit_if_pending` does nothing for a detect project, or when the library is `None`.
- [ ] `GET /adoption` counts, and `retry` resets the missing rows.
- [ ] Move: train → detect copies the map, its zones and labels, and `GET /maps` in the target lists it. Train → train → 409. Moving an already-moved map → the job fails with a readable message.
- [ ] **Gate:** the backend gate, fully green.

## Unit FM — Frontend adoption banner and move-map

**Owns:** new `frontend/src/app/AdoptionBanner.tsx` (plus its test), the banner's placement in `screens/HomeScreen.tsx`, a "Move to a detection project" action in `PastDetectionsScreen`'s maps section (new `maps/MoveMapDialog.tsx`), and `api/adoption.ts` (`fetchAdoption`, `retryAdoption`, `moveMap`).

**Behaviour:**
- **Adoption banner** (train projects only):
  - while `pending > 0` and a job is running: an info `Alert`, "Moving this project's models into your library…", with progress
  - `missing.length > 0`: a warn `Alert` listing names and errors, with a **Retry** button
  - nothing when everything is adopted
- **MoveMapDialog:** a `Select` of detection projects taken from `GET /projects` filtered by `kind === "detect"`, plus "New detection project…", which reveals a Name and a FolderField. Choosing new creates the project with `POST /projects {kind: "detect", classes: []}` first. Submitting calls `moveMap`, shows the target job's progress (polled via that project's jobs), and on success offers "Open <target>".

**Tests first:** the banner's three states; the dialog creates a new project and then moves; the dialog lists only detection projects.

- [ ] **Gate:** lint, test, build.

## Merge wave 2

- [ ] Merge BM, then FM, into integration. Run the backend gate after BM and the frontend gate after FM.

---

## Unit X — End-to-end, docs, evidence (in the integration worktree)

- [ ] **e2e** (Playwright against the Prism mock, with `page.route` overrides as in the existing specs):
  1. `library.spec.ts`: the list, the detail, and import → job → the new model is selected.
  2. `projects.spec.ts`: create a detection project → the sidebar shows the detect steps; a training project shows the train steps plus Library.
  3. `past-detections.spec.ts`: a train project with `queryRuns > 0` shows Past detections, read-only.
  Update any existing spec that hit `/p/<P>/models` or the old sidebar.
- [ ] **Backend migration e2e** (`test_library_adoption.py::test_real_project_copy`): build a project at revision `0005` with an old `Model` row and a weights file (the stub checkpoint). Open it through the API, `wait_job` the adoption, and assert `GET /library/models` lists it and `GET /query-runs` still returns the old run with the new `model_id`.
- [ ] **Docs:**
  - `docs/progress.md`: a ledger entry with the gate results
  - `docs/usability/2026-09-23-library-walkthrough.md`: the operator's numbered "how to test this"
  - `vault/decisions/`: an ADR, "Library jobs reuse the project JobRunner via a project-shaped handle"
  - `CONTRIBUTING.md`: any gate or path change
- [ ] **Full gate** in the integration worktree (all 7 lines from AGENTS.md; e2e on free ports).
- [ ] `scripts\finish-task.ps1` from the integration worktree: it rebases on `main`, gates, fast-forwards `main`, and removes the worktree. First check that the main checkout is clean and on `main`.
