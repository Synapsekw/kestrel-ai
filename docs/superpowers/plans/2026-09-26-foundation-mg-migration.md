# Foundation MG: migration of existing projects. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan has **two parts with two worktrees**: Part A (MG-framework, Tasks 0–8) and Part B (MG-steps, Tasks 9–16). Part B starts only after Part A, BC and BM have merged.

**Goal:** Upgrade every existing project to the foundation schema on first start, copy-first and resumable, so that a failure skips and flags one project while the app still opens, and the operator's real folders are proven safe by a dry run on copies before this unit merges.

**Architecture:**
- **Copy-first backup in `open_project_db`.** Before Alembic runs, the database's current revision is read. When the upgrade will apply revision `0010`, SQLite's online backup API writes `<project>\backups\project.db.v1-<UTC stamp>.bak` and checks it with `PRAGMA quick_check`. A failed backup raises `BackupFailed`, and the upgrade does not run.
- **Orchestration (`backend/app/migration/`).** The data steps run as a `project_migrate` job in the **library** runner, one per project. A step ledger (`migration_step`) makes every step run at most once, so a new job resumes where a failed or cancelled one stopped. `migrations.json` in the app-data folder records each project's state. `get_project` answers `409 project_upgrading` or `409 project_upgrade_failed` while a project is below schema version 2. `GET /projects` lists a failing project as an item instead of failing.
- **The steps (Part B).** Seven data steps from spec §11.4: merge classes into the catalogue by name as `object` types, rewrite class ids to catalogue type ids (set-based SQL on rows, JSON on run rows), build `project_type`, move model class maps into the library, register materialised datasets as legacy library datasets, turn accepted defect boxes into numbered findings, and rebuild the counts. Then `finish` sets `schema_version = 2` and writes a report. Nothing is deleted.
- **Part A ships disarmed.** `app.migration.steps.PIPELINE` is empty until Part B. With no steps, nothing is submitted, no project is gated and no project is marked upgraded. The backup, the list isolation and Retry are live from Part A.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 (SQLite, Core `text()` for tables owned by other units), Alembic, stdlib `sqlite3` (backup API, read-only probes), pytest, schemathesis (the existing contract test). There is no frontend work and no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (F): §11 in full, plus §1.7, §3 (F2, F3, F4, F8, F10), §6.1, §7.1–§7.4, §8.1, §9.2 (migration state, per-project isolation), §12.1, §13, §14, §15, §16 ("Migration"), §17.7, §18 (unit **MG**) and §19.1–§19.2. Umbrella: `docs/superpowers/specs/2026-09-26-inspection-platform-design.md` D6 (with its F4 note), §6 ("Migration ids"), §8 ("The app starts even if migration fails") and §10 items 2, 5 and 10.

**Where this runs:**

| Part | Worktree | Branch | Cut from `main` after | Merges |
| --- | --- | --- | --- | --- |
| A, MG-framework | `E:\Dev\Yolo\app\.claude\worktrees\f-mg-framework` | `task/f-mg-framework` | C0 (contract) | batch 2, right after BK (see "Merge order") |
| B, MG-steps | `E:\Dev\Yolo\app\.claude\worktrees\f-mg-steps` | `task/f-mg-steps` | MG-framework, BC **and** BM | batch 3, after the real-folder dry run passes |

**Sibling plans.** C0's plan is `docs/superpowers/plans/2026-09-26-foundation-c0-contract.md`, BC's is `2026-09-26-foundation-bc-catalogue-findings.md`, and BM's is `2026-09-26-foundation-bm-models-backend.md`. None of these existed when this plan was written. BK's plan (`2026-09-26-foundation-bk-kind-removal-data-list.md`) did, and this plan uses its post-merge shapes: `ProjectRegistry.create(name, folder, type_ids)`, `_cache(pid, folder, engine, name, remember)`, `_name(h)`, `AppData.remember(project_id, name, folder)`, `tests/project_factory.py::new_project`, and `app.state.jobs.projects` kept. Every C0, BC and BM name below is the **spec's name verbatim**, and each one is listed in "Names to reconcile". Task 0 checks C0's names, and Task 9 checks BC's and BM's. Where they differ, **the merged unit wins**: rename in this plan's code and tests before writing them.

## DAG position and merge order

- **Spec §18:** MG-framework is in **batch 2** (`DS ∥ BK ∥ BC ∥ BM ∥ MG-framework`) and has no dependency. MG-steps is in **batch 3** (`SH ∥ MG-steps`) and needs BC and BM merged. The backend chain C0 → BC → MG-steps runs alongside the frontend critical path C0 → DS → SH → S1 → X, and must finish before X. MG's real-folder dry run gates **merging MG**. It does not gate starting S1 or S2.
- **Merge order in batch 2 (changed from spec §18):** **BK → MG-framework → BC → BM.** Spec §18 puts MG-framework last. This plan moves it before BC because BC's revision `0010` rewrites the `project` table (it drops `project.kind`). If `0010` reached `main` before the backup guard, any build of `main` in that window would upgrade real projects with no copy. MG-framework is small, and its Tasks 5–7 need BK merged anyway. If BC is ready first, BC waits for MG-framework's slot. The coordinator's index adopts this order (binding).
- **Inside Part A** (one worktree, one implementer at a time, per ADR `2026-09-23-gotcha-parallel-branches-collide-on-migration-ids`):
  - Tasks 1 and 2 are independent. Task 3 needs Task 1, and Task 4 needs Tasks 1 and 3. None of Tasks 1–4 touches a file BK changes, so they can run before BK merges.
  - Tasks 5 → 6 → 7 edit `app/projects/*` and `app/main.py`, which BK rewrites. Task 5 starts with a rebase onto `main` with BK merged.
  - Critical path: 1 → 3 → 5 → 6 → 7 → 8.
- **Inside Part B:**
  - Task 9 (rebase, ports) comes first. Tasks 10–14 each add one or two steps to `steps.py`. They are logically independent, but they share that file, so they run in order.
  - Task 15 arms the pipeline, and Task 16 is the real-folder merge gate.
  - Critical path: 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16.

## Budget (AGENTS.md §6)

- **Background jobs:** `project_migrate` (library runner, one per project, resumable, with progress per step). The dry run is a script the operator runs by hand, never a request. The backup and the schema upgrade run inside `open_project_db`, as spec F8 decides. `GET /projects` never opens a project whose upgrade job is live (Task 7), so the list does not wait on a backup.
- **Bounded reads:**
  - **Backup:** SQLite's page-level backup API. No row is read into Python.
  - **Class id rewrite:** one set-based `UPDATE … WHERE class_id IN (SELECT …)` per row table (`box`, `map_detection`, `map_label`). No row is loaded.
  - **JSON rewrites:** only `query_run`, `map_run`, `model_class_map` and `dataset` rows. These are tens per project.
  - **Findings from boxes:** batches of 1000 box ids per transaction. Each batch is a `LIMIT`ed query over the eligible boxes.
  - **Legacy dataset counts:** `GROUP BY` over `dataset_image` and `json_each(boxes)` in SQL. No `dataset_image` row is loaded into Python.
  - **Startup:** one read-only `SELECT schema_version` per recent project (≤ `MAX_RECENT` = 20). No project is opened at startup.
  - **Catalogue lookups:** non-archived `catalogue_type` rows (tens to hundreds) per class.
  - `migrations.json` holds one small entry per project ever upgraded.

## Global Constraints

- **Contract-first.** `contract/openapi.yaml` is the source of truth and C0 owns it. **No MG task edits `contract/`.** MG consumes these C0 names (spec §13):
  - `POST /projects/migrations/retry {folder}`
  - `Project.migration` (`MigrationState`)
  - `JobType` `project_migrate`
  - `Event.type` `migration.changed`
  - the 409 codes `project_upgrading` (`{job_id}`) and `project_upgrade_failed` (`{error, backup_path}`)

  A contract gap goes to the coordinator as a C0 change.
- **Backup (spec §11.2), verbatim:**
  - `PRAGMA wal_checkpoint(TRUNCATE)`, then `sqlite3.Connection.backup()` into `<project>\backups\project.db.v1-<UTC stamp>.bak`, then `PRAGMA quick_check` on the copy.
  - A failed backup raises `BackupFailed`. The upgrade does **not** run, and the project is flagged `failed` with the code `backup_failed`.
  - "An existing backup for the same revision is kept. The next backup gets a new stamp, and the app never deletes backups." The app never restores a backup automatically.
- **`migrations.json`** lives in the app-data folder (`settings.data_dir`; on the operator's machine `%APPDATA%\ai.synapse-solutions.kestrel-ai`). It is keyed by the lower-cased folder: `{state, job_id, error, backup_path, report_path, updated_at}`, plus `code`, `step`, `project_id` and `folder` (resolved ambiguity 6).
- **Target:** `project.schema_version = 2`. The report is `<project>\backups\migration-v2.json` (steps, counts, warnings, duration).
- **Revision ids (spec §11.1, umbrella §6):** project `0010` is BC's, library `0002` is BM's, and catalogue `0001` is BC's. **MG writes no Alembic revision.**
- **No deletion (spec §19.1):**
  - `Project.classes` and `model_class_map` are kept and only read.
  - `dataset_image.boxes` is **not** rewritten.
  - No file, folder or backup is deleted, and no original is opened for writing by the dry run.
- **F4 (operator-confirmed):** a migrated type is created with `kind: object` and `origin: migrated`, and `catalogue_meta.needs_classification` is set. Classes merge into the catalogue **by name** (`normalise_name`).
- **The app must start even when startup work fails** (AGENTS.md). Every startup call is wrapped and logged. A damaged `migrations.json` reads as empty. One failing project never fails `GET /projects`.
- **Tests never touch the real `%APPDATA%`** (CONTRIBUTING.md). They use the `settings` fixture's temp `data_dir` and `tmp_path` project folders. The one exception is `tests/test_migration_real.py`, which is opt-in (`KESTREL_REAL_PROJECTS`) and reads originals only.
- **Interpreter:** a worktree has no venv. Every backend command runs from `<worktree>\backend` with:
  ```powershell
  $PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
  ```
  Nothing is installed.
- **Git:** stage by path, never `git add -A`. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. The commit identity is pinned by `scripts\start-task.ps1`.
- **Windows paths in code:** use the Write/Edit tools, not bash heredocs, for any file containing `\\` (ADR `2026-09-19-gotcha-bash-heredoc-collapses-backslashes`).
- **The gate** (AGENTS.md §4), in full before each merge:
  ```powershell
  pnpm -C contract check
  cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e  # scripts\finish-task.ps1 runs it on free ports
  cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
  ```
  Never run two gates at once on this machine (ADR `2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner`).

## Review Focus

These five inputs are implied by the spec, but no spec test names them, and they are the most likely to bite the operator. Each one has a pinning test in the task named.

1. **Two projects upgrade at the same time.** The library runner has two workers, so two jobs merge "dump_truck" into the catalogue at once. Expected: exactly one `dump_truck` type, with no duplicate and no failed step. The catalogue and library write sections are serialised by one process lock. Pinned in Task 10 (`test_two_projects_merging_at_once_create_one_type`).
2. **The dry run copies a database whose newest rows are still in `-wal`,** because the app is running or crashed. Expected: the copy includes them, since `-wal`/`-shm` are copied too. The invariants see them. Pinned in Task 4 (`test_rows_still_in_the_wal_are_copied`).
3. **The app quit in the middle of an upgrade.** `migrations.json` says `pending` with a job id that no process holds any more. Expected: the next start queues a new job, the ledger skips the steps that finished, and nothing is duplicated. Pinned in Task 6 (`test_an_upgrade_the_last_run_left_unfinished_is_queued_again`) and Task 15 (`test_a_crash_between_steps_resumes_without_duplicates`).
4. **Two classes of one project normalise to one name** ("Dump truck" and "dump_truck", from an old rename). Expected: one catalogue type, one `project_type` row, and counts JSON keys summed rather than overwritten. Pinned in Task 10 (`test_two_spellings_in_one_project_become_one_type`), Task 11 (`test_counts_follow_their_class_and_merge_when_two_classes_became_one`) and Task 12 (`test_duplicate_types_get_one_row_in_the_old_order`).
5. **A project that never needed upgrading.** It was created after this unit armed, or between BC and MG-steps (with `project_type` rows already written by BC's `create`). Expected: a new project is born at version 2 and never gets a job. A project that already has `project_type` rows keeps them. Pinned in Task 15 (`test_a_new_project_is_born_upgraded`) and Task 12 (`test_existing_project_type_rows_are_kept`).

## Spec ambiguities resolved while planning

Reviewers should not flag these. Each one is also in the report to the coordinator.

1. **Where `migrations.json` lives.** Spec: `%APPDATA%\kestrel-ai\migrations.json`. The backend's data folder is `settings.data_dir`, which the Tauri shell sets to `%APPDATA%\ai.synapse-solutions.kestrel-ai`. The file lives there, beside `recent_projects.json`.
2. **"Below `0010`".** This means the upgrade from the current revision to head will **apply** `0010`: `0010` is on the walk from current to head. A new database with no revision is not backed up, because there is nothing to lose. A chain without `0010` (Part A before BC) never backs up.
3. **Partial backups.** The copy is written as `….bak.partial` and renamed only after `quick_check` passes. A failed partial is removed, because it is not a backup. Two backups in the same second get `-2`, `-3` suffixes.
4. **Part A ships disarmed** (empty `PIPELINE`). Otherwise projects would be marked version 2 before any data step existed, and Part B would never migrate them. Disarmed, Retry only reopens the project, which retries its backup.
5. **Merge order** BK → MG-framework → BC → BM (see "DAG position"). This deviates from spec §18.
6. **Stored vs derived state.** `migrations.json` stores `pending`, `ok` and `failed`. `running` is **derived**: it means a `pending` entry whose job is live in this process. Extra keys `code` (`backup_failed | step_failed | open_failed | cancelled`), `step` and `project_id` carry spec §15's "the flag carries the step and error".
7. **A failed upgrade is not re-run automatically.** Opening a failed project, or restarting the app, does not submit a new job. Only Retry does. A cancelled upgrade is flagged `failed` with the code `cancelled`, so Retry is the one way on.
8. **A deleted folder is listed as missing (operator decision 2026-09-26).** A recent project whose folder or `project.db` is gone is **listed**, built from its recent entry with `availability: "missing"` (C0's `ProjectAvailability`) and `migration.state: "ok"`; S1 shows it as "Folder not found" with Remove from list and Locate folder…. Remove from list is `DELETE /projects/{id}` (`ProjectRegistry.forget` drops a missing entry without opening it). Locate folder… is today's `POST /projects/open` on the new folder; `AppData.remember` replaces any recent entry with the same project id, so the stale entry goes. Today's `tests/test_projects.py::test_recent_skips_deleted_folders` is changed deliberately (Task 7). A database that exists but cannot be opened, read or upgraded is still listed as `migration.state: "failed"`.
9. **The list item for a project that cannot be opened** is built from its `recent_projects.json` entry: `classes: []`, `schema_version: 0`, and `created_at` = its `last_opened_at`. C0 must allow that. If `Project.summary` exists by then, it is `null` for such an item.
10. **`GET /projects` never opens a project whose upgrade job is live.** It lists the project as `running` from its recent entry, so the list never waits on the registry lock the job holds during backup.
11. **Catalogue unavailable** means waiting, like the library (spec §15). The job is not submitted, and the project answers `409 project_upgrading` with `job_id: null` and the message "Waiting for the catalogue". Part B adds this.
12. **Merge by name matches non-archived types only.** An archived match does not absorb the class, so a new type is created. This follows spec §7.1: names are unique among non-archived rows.
13. **Hotkeys and colours:**
    - A new catalogue type takes the class hotkey only if it is free in the catalogue.
    - A project keeps its old hotkey as `project_type.hotkey_override` when that key clashes with no catalogue hotkey of another type in the project. Otherwise the catalogue's key wins, and a warning says so.
    - The first project's colour wins.
14. **Legacy datasets:**
    - Only a **materialised** dataset is registered: `data.yaml` exists under the original folder.
    - Name `"<dataset> (<project>)"`, with ` 2`, ` 3` suffixes on a clash. This matters on the operator's machine, where two projects are both named "Ahmadia".
    - `task: detect`, `state: ready`, `export_state: ready`, `export_path: null`, no `dataset_item` rows.
    - `counts {images, per_class, train, val}`. Idempotency is keyed by `legacy_path`.
15. **Findings from boxes (step 6):**
    - `created_by` is `human` for person boxes, and otherwise `model:<box.model_id>`, falling back to `model:<box.provider>` for cloud boxes.
    - `created_at` is the box's `created_at`.
    - `data_type: image_set`, and `data_id` is the image's `source_id`.
    - Numbers are `max + 1` in `(box.created_at, box.id)` order.
    - Spec §11.4 says the backfill job "reuses this function". **Settled (reconciliation 2026-09-26):** BC owns the one implementation, `app.findings.backfill.findings_from_annotations(handle, type_ids=None, *, batch=1000, progress=None, check_cancelled=None) -> int` (batched, idempotent on `annotation_id`, the rules above); step 6 calls it with `type_ids=None`. MG writes no box → finding code of its own.
16. **"Project upgraded" activity.** The spec's `activity.kind` enum has no upgrade kind, so the row uses `job.finished` with the summary "Project upgraded". It is written once, even across re-runs.
17. **New projects are born at `schema_version = 2`** once Part B arms (Task 15). They have no legacy classes to migrate.
18. **Class ids are not reused as type ids.** A merged type gets a new uuid. Step 2 rewrites "where old ≠ new", which after one run matches nothing.

## Names to reconcile (spec names used verbatim; the merged unit wins)

| Unit | Name this plan uses | Used in |
| --- | --- | --- |
| C0 | operationId `retryProjectMigration` for `POST /projects/migrations/retry`, 202 → `MigrationState` | Task 7 |
| C0 | `MigrationState {state: ok\|pending\|running\|failed, job_id, error, code, step, backup_path, report_path}`, every field but `state` optional and nullable | Task 7 |
| C0 | `Project.migration` required, `Project.summary` nullable | Task 7 |
| C0 | a 409 response on project-scoped operations for `project_upgrading` / `project_upgrade_failed` | Tasks 6, 7 |
| BC | `app.catalogue.handle.open_catalogue_db(data_dir) -> CatalogueHandle` (`.session()`, `.engine`); `app.state.catalogue`; `runner.catalogue` (BC wires it in `lifespan`, its Task 1: `app.state.jobs.catalogue = app.state.catalogue`) | Tasks 9, 15 (verify only) |
| BC | `app.catalogue.service.normalise_name(name: str) -> str` | Task 9 |
| BC | `app.findings.counts.recount(session) -> None` (rebuilds `finding_count` and `finding_daily`) | Tasks 9, 14 |
| BC | tables `catalogue_type`, `catalogue_meta`, `project_type`, `class_id_map`, `finding`, `finding_count`, `activity`, `migration_step`, with spec §7.1/§7.3/§8.1 columns (`project_type."group"`, `catalogue_type."group"`) | Task 9 schema guard |
| BC | `ProjectRegistry.create(name, folder, type_ids)` writes `project_type` | Task 15 |
| BC | `app.findings.backfill.findings_from_annotations(handle, type_ids=None, *, batch=1000, progress=None, check_cancelled=None) -> int` (`type_ids=None`: every defect type of the project; `progress(done, total)`; reads `handle.catalogue`) | Task 14 (settled: step 6 calls it) |
| BM | library tables `dataset`, `dataset_source` (spec §12.1 columns) and `library_model.class_map` | Task 9 schema guard |

---

# Part A: MG-framework (`task/f-mg-framework`)

## Part A file map

| File | Task | Change |
| --- | --- | --- |
| `backend/app/migration/__init__.py` | 1 | **new**, docstring only |
| `backend/app/migration/backup.py` | 1 | **new**: `BackupFailed`, `needs_backup`, `backup_project_db`, `latest_backup`, `quick_check` |
| `backend/app/db/session.py` | 1 | backup before upgrade; `alembic_config`, `project_script`, `head_revision`, `current_revision` |
| `backend/app/migration/state.py` | 2 | **new**: `MigrationStates`, `failed_error`, `upgrading_error` |
| `backend/app/migration/ledger.py` | 3 | **new**: `done_steps`, `record` |
| `backend/app/migration/pipeline.py` | 3 | **new**: `Step`, `StepContext`, `MigrationEnv`, `StepFailed`, `run_pipeline`, `finish` |
| `backend/app/migration/steps.py` | 3 | **new**: `PIPELINE = ()` |
| `backend/app/migration/invariants.py` | 4 | **new**: `snapshot`, `compare` |
| `backend/scripts/migration_dry_run.py` | 4 | **new** |
| `backend/pyproject.toml` | 4 | marker `real_data` |
| `backend/app/projects/service.py` | 5, 6 | `ProjectHandle.schema_version`; `open` flags `BackupFailed`; `get_project` gate |
| `backend/app/migration/job.py` | 5 | **new**: `project_migrate`, `submit`, `armed`, `blocked_reason`, `live_job_id`, `states_for` |
| `backend/app/migration/gate.py` | 6, 7 | **new**: `migration_state`, `ensure_submitted`, `require_ready`, `unavailable_state` |
| `backend/app/migration/startup.py` | 6 | **new**: `probe_schema_version`, `submit_pending` |
| `backend/app/main.py` | 6 | `project_opened` step; lifespan submits pending upgrades |
| `backend/app/projects/schemas.py` | 7 | `MigrationStateOut`; `ProjectOut.migration`, `ProjectOut.unavailable` |
| `backend/app/projects/router.py` | 7 | `list_projects` isolation; `_out(handle, runner)` |
| `backend/app/migration/router.py` | 7 | **new**: `POST /projects/migrations/retry` |
| `backend/app/api.py` | 7 | include the migration router |
| `backend/tests/migration_helpers.py` | 1 (+3, 5) | **new**: legacy-project builders and small tools |
| `backend/tests/test_migration_backup.py`, `test_migration_state.py`, `test_migration_pipeline.py`, `test_migration_dry_run.py`, `test_migration_real.py`, `test_migration_job.py`, `test_migration_gate.py`, `test_migration_projects_api.py` | 1–7 | **new** |
| `vault/decisions/2026-09-26-migration-framework-ships-disarmed.md` | 8 | **new** ADR |

---

### Task 0: Preflight (no code, no commit)

**Files:** none changed.

**Interfaces:**
- Produces: C0's names confirmed or corrected in "Names to reconcile", which Tasks 6 and 7 use.

- [ ] **Step 1: Confirm C0 is on `main`**

Run (PowerShell, from `E:\Dev\Yolo\app`):
```powershell
git log --oneline main -15
Select-String -Path contract\openapi.yaml -Pattern "/projects/migrations/retry:|MigrationState:|project_migrate|migration.changed|project_upgrading|project_upgrade_failed"
```
Expected: C0's merge commit in the log, and every pattern printed at least once. If `/projects/migrations/retry:` or `MigrationState:` is missing, stop: C0 has not landed.

- [ ] **Step 2: Cut the worktree**

```powershell
scripts\start-task.ps1 f-mg-framework
cd E:\Dev\Yolo\app\.claude\worktrees\f-mg-framework
git branch --show-current
```
Expected: `task/f-mg-framework`.

- [ ] **Step 3: Read C0's names**

In the worktree's `contract/openapi.yaml`, read the retry operation (its operationId, request body, responses) and the `MigrationState` schema. Correct the C0 rows of "Names to reconcile" in your notes. Then find how C0 routed the unbuilt operation:
```powershell
cd backend
Select-String -Path app\*.py,app\*\*.py -Pattern "migrations/retry|retryProjectMigration"
Select-String -Path tests\test_contract.py -Pattern "EXPECTED_STUBS|retryProjectMigration"
```
Record the module and `STUBS` entry, if C0 routed it as a 501 stub. Task 7 deletes them.

- [ ] **Step 4: Baseline**

```powershell
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY -m pytest -q -x
```
Expected: the suite passes, or fails **only** on contract/`kind` drift that C0 introduced and BK fixes. Record which. Tasks 1–4 do not depend on it.

---

### Task 1: Copy-first backup in `open_project_db`

**Files:**
- Create: `backend/app/migration/__init__.py`, `backend/app/migration/backup.py`, `backend/tests/migration_helpers.py`
- Modify: `backend/app/db/session.py` (whole file, 38 lines today)
- Test: `backend/tests/test_migration_backup.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `app.migration.backup`:
    - `BACKUP_BEFORE: str = "0010"` and `BACKUPS_DIR = "backups"`
    - `class BackupFailed(Exception)`, with `code = "backup_failed"`
    - `needs_backup(current: str | None, script: ScriptDirectory) -> bool`
    - `backup_project_db(folder: Path, now: datetime | None = None) -> Path`
    - `latest_backup(folder: Path) -> Path | None`
    - `quick_check(path: Path) -> str`
    - `backups_dir(folder: Path) -> Path`
  - `app.db.session`:
    - `alembic_config(folder: Path | None = None) -> Config`
    - `project_script() -> ScriptDirectory`
    - `head_revision() -> str`
    - `current_revision(folder: Path) -> str | None`
    - `open_project_db(folder)`, unchanged signature
  - `tests/migration_helpers.py` (full content below), used by every MG test.

- [ ] **Step 1: Write the test helpers**

Create `backend/tests/migration_helpers.py`:

```python
"""Pre-foundation project folders and small tools for the migration tests (foundation spec §11, §16).

Old databases are built with Alembic to an old revision and filled with raw SQL: the ORM describes
the newest schema, which an old database does not have.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.db.session import MIGRATIONS, open_project_db
from app.projects.service import ProjectHandle

T0 = "2026-01-01 00:00:00.000000"
PID = "p-legacy"
AUTH = {"Authorization": "Bearer test-token"}
CLASSES = [
    {"id": "c-exc", "name": "excavator", "colour": "#f97316", "hotkey": "1", "order": 0},
    {"id": "c-dump", "name": "dump_truck", "colour": "#06b6d4", "hotkey": "2", "order": 1},
]
# The ledger before unit BC's revision 0010 creates it. Only ever run on a database at head:
# on an older one, 0010 would then fail to create the table.
LEDGER_DDL = (
    "CREATE TABLE IF NOT EXISTS migration_step "
    "(name VARCHAR NOT NULL PRIMARY KEY, done_at DATETIME NOT NULL, detail JSON NOT NULL)"
)
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
# Box outcomes written for each class, in creation order (seconds 0..4).
OUTCOMES = [
    ("accepted", "local_model"),
    ("edited", "local_model"),
    ("accepted", "person"),
    ("unreviewed", "local_model"),
    ("rejected", "local_model"),
]


def alembic_cfg(folder: Path | None = None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


@contextmanager
def db(folder: Path):
    con = sqlite3.connect(folder / "project.db")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def at_revision(
    folder: Path, revision: str, *, name: str = "Legacy", classes: list[dict] = CLASSES, pid: str = PID
) -> Path:
    """A project folder whose database is at `revision`, with its one `project` row (version 1)."""
    folder.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_cfg(folder), revision)
    with db(folder) as con:
        con.execute(
            "INSERT INTO project (id, name, classes, schema_version, import_defaults, created_at)"
            " VALUES (?, ?, ?, 1, '{}', ?)",
            (pid, name, json.dumps(classes), T0),
        )
    return folder


def legacy_at_head(folder: Path, *, pid: str = PID, name: str = "Legacy") -> Path:
    """A version-1 project already at the newest revision, with the step ledger in place."""
    at_revision(folder, "head", pid=pid, name=name)
    add_ledger_table(folder)
    return folder


def add_ledger_table(folder: Path) -> None:
    with db(folder) as con:
        con.execute(LEDGER_DDL)


def set_schema_version(folder: Path, version: int) -> None:
    with db(folder) as con:
        con.execute("UPDATE project SET schema_version = ?", (version,))


def revision_of(db_file: Path) -> str | None:
    con = sqlite3.connect(f"{Path(db_file).resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = con.execute("SELECT version_num FROM alembic_version").fetchone()
    finally:
        con.close()
    return row[0] if row else None


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def add_images_and_boxes(folder: Path, classes: list[dict] = CLASSES) -> None:
    """One source, two images (i1 has a GPS fix), and on each class one box per OUTCOMES entry.
    Box n of a class is on i1 when n is even, on i2 otherwise. Works from revision 0001."""
    with db(folder) as con:
        con.execute(
            "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at)"
            " VALUES ('s1', 'C:/photos', 'site', '{}', 2, 0, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO image (id, path, width, height, source_id, lat, lon, group_key, created_at)"
            " VALUES ('i1', 'images/site/a.jpg', 100, 100, 's1', 25.1, 55.2, '', ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO image (id, path, width, height, source_id, group_key, created_at)"
            " VALUES ('i2', 'images/site/b.jpg', 100, 100, 's1', '', ?)",
            (T0,),
        )
        for c in classes:
            for n, (state, provenance) in enumerate(OUTCOMES):
                model = None if provenance == "person" else "m-old"
                con.execute(
                    "INSERT INTO box (id, image_id, class_id, x, y, w, h, confidence, provenance_kind,"
                    " model_id, review_state, created_at) VALUES (?, ?, ?, 1, 1, 5, 5, ?, ?, ?, ?, ?)",
                    (
                        f"b-{c['id']}-{n}",
                        "i1" if n % 2 == 0 else "i2",
                        c["id"],
                        None if model is None else 0.9,
                        provenance,
                        model,
                        state,
                        f"2026-01-01 00:00:0{n}.000000",
                    ),
                )


def add_detect_rows(folder: Path, classes: list[dict] = CLASSES) -> None:
    """Revision 0008 or later: a map with a run whose counts, verified counts, area counts and class
    map name the first two classes, four detections and a label, a query run, and a model class map."""
    a, b = classes[0]["id"], classes[1]["id"]
    with db(folder) as con:
        con.execute(
            "INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,"
            " band_count, dtype, stretch, labels_version, created_at) VALUES ('m1', 'April', 'ready',"
            " 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO map_run (id, map_id, kind, query, tile_size, overlap, nms_iou, conf, counts,"
            " created_at, verified_counts, area_counts, class_map) VALUES ('r1', 'm1', 'local_model', '',"
            " 1280, 0.2, 0.5, 0.25, ?, ?, ?, ?, ?)",
            (
                json.dumps({a: 3, b: 1}),
                T0,
                json.dumps({a: 1}),
                json.dumps({"area1": {a: {"total": 2, "verified": 1}, b: {"total": 1, "verified": 0}}}),
                json.dumps({"excavator": a, "truck": b, "person": None}),
            ),
        )
        for i, cid in enumerate([a, a, a, b]):
            con.execute(
                "INSERT INTO map_detection (id, run_id, class_id, confidence, x, y, w, h, review_state)"
                " VALUES (?, 'r1', ?, 0.8, ?, 1, 4, 4, 'unreviewed')",
                (f"d{i}", cid, float(i)),
            )
        con.execute(
            "INSERT INTO map_label (id, map_id, class_id, x, y, w, h, source, created_at, updated_at)"
            " VALUES ('l1', 'm1', ?, 1, 1, 4, 4, 'manual', ?, ?)",
            (b, T0, T0),
        )
        con.execute(
            "INSERT INTO query_run (id, kind, query, image_ids, tiling, conf, created_at, counts,"
            " verified_counts, class_map) VALUES ('q1', 'local_model', '', '[]', '{}', 0.25, ?, ?, ?, ?)",
            (T0, json.dumps({a: 2}), json.dumps({a: 1}), json.dumps({"excavator": a})),
        )
        con.execute(
            "INSERT INTO model_class_map (library_model_id, mapping, updated_at) VALUES ('lib-m1', ?, ?)",
            (json.dumps({"excavator": a, "truck": b, "bird": None}), T0),
        )


def add_dataset(
    folder: Path, *, name: str = "v1", materialised: bool = True, classes: list[dict] = CLASSES
) -> str:
    """A frozen dataset over i1 (needs add_images_and_boxes); `materialised` writes its data.yaml."""
    dataset_id = f"ds-{name}"
    with db(folder) as con:
        con.execute(
            "INSERT INTO dataset (id, name, classes, split_method, split_params, path, created_at)"
            " VALUES (?, ?, ?, 'random', ?, ?, ?)",
            (dataset_id, name, json.dumps(classes), json.dumps({"val_fraction": 0.2, "seed": 0}),
             f"datasets/{name}", T0),
        )
        boxes = [{"class_id": c["id"], "x": 1, "y": 1, "w": 5, "h": 5} for c in classes]
        con.execute(
            "INSERT INTO dataset_image (dataset_id, image_id, split, boxes) VALUES (?, 'i1', 'train', ?)",
            (dataset_id, json.dumps(boxes)),
        )
    if materialised:
        root = folder / "datasets" / name
        root.mkdir(parents=True, exist_ok=True)
        names = "".join(f"  {i}: '{c['name']}'\n" for i, c in enumerate(classes))
        (root / "data.yaml").write_text(f"path: '.'\ntrain: images/train\nval: images/val\nnames:\n{names}", "utf-8")
    return dataset_id


def add_cloud_rows(folder: Path) -> None:
    """Revision 0009 or later: a point cloud with a measurement, a surface and a volume on it."""
    with db(folder) as con:
        con.execute(
            "INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)"
            " VALUES ('pc1', 'Scan', 'ready', 'C:/scan.laz', 1, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO cloud_measurement (id, point_cloud_id, kind, name, points, results, created_at,"
            " updated_at) VALUES ('cm1', 'pc1', 'distance', 'D1', '[]', '{}', ?, ?)",
            (T0, T0),
        )
        con.execute(
            "INSERT INTO surface (id, name, kind, status, created_at) VALUES ('sf1', 'DSM', 'cloud_dsm',"
            " 'ready', ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO volume_measurement (id, name, polygon_native, top_surface_id, base, masks,"
            " alignment, status, created_at, updated_at) VALUES ('v1', 'Pile', '[]', 'sf1', '{}', '[]',"
            " '{}', 'ready', ?, ?)",
            (T0, T0),
        )


def open_handle(folder: Path) -> ProjectHandle:
    """Open a folder the way the registry does (backup, upgrade) without the registry, ledger ready."""
    engine = open_project_db(folder)
    with engine.begin() as c:
        c.exec_driver_sql(LEDGER_DDL)
        pid, version = c.exec_driver_sql("SELECT id, schema_version FROM project").one()
    handle = ProjectHandle(pid, folder, engine)
    handle.schema_version = version
    return handle


def arm(monkeypatch, *steps) -> None:
    """Set the migration pipeline for one test; `arm(monkeypatch)` disarms it."""
    from app.migration import steps as steps_module

    monkeypatch.setattr(steps_module, "PIPELINE", tuple(steps))


class HeldStep:
    """A step that waits until the test releases it: a job that is live on demand."""

    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()

    def step(self):
        from app.migration.pipeline import Step

        def run(ctx):
            self.entered.set()
            assert self.release.wait(30), "the test never released the held step"
            return {}

        return Step("held", "Holding", run)


def wait_library_job(client, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/v1/library/jobs/{job_id}").json()
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"library job {job_id} did not finish within {timeout}s")


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
```

`HeldStep`, `arm`, `open_handle` and `wait_library_job` are used from Task 3 on. They import lazily, so this file imports cleanly now. `open_handle` sets `schema_version` as an attribute, so it works before and after Task 5 adds it to `ProjectHandle`.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_migration_backup.py`:

```python
"""Copy-first backup in open_project_db (foundation spec §11.2, §16 "Migration")."""

from datetime import UTC, datetime

import pytest
from migration_helpers import at_revision, revision_of, sha256

from app.db.session import current_revision, head_revision, open_project_db, project_script
from app.migration import backup
from app.migration.backup import BackupFailed, backup_project_db, latest_backup, needs_backup, quick_check


@pytest.fixture
def guard_0009(monkeypatch):
    """Stand-in for 0010 until BC's revision exists: the backup guards 0009, so 0008 needs one."""
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")


def test_needs_backup_only_when_the_upgrade_applies_the_guarded_revision(guard_0009):
    script = project_script()
    assert needs_backup("0008", script) is True
    assert needs_backup("0001", script) is True
    assert needs_backup("0009", script) is False
    assert needs_backup(None, script) is False


def test_an_unknown_revision_never_asks_for_a_backup(monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "9999")
    assert needs_backup("0001", project_script()) is False
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    assert needs_backup("not-a-revision", project_script()) is False  # a newer build's database


def test_the_backup_is_taken_before_the_upgrade_and_passes_quick_check(tmp_path, guard_0009):
    folder = at_revision(tmp_path / "old", "0008")
    open_project_db(folder).dispose()
    copy = latest_backup(folder)
    assert copy is not None and copy.parent == folder / "backups"
    assert copy.name.startswith("project.db.v1-") and copy.name.endswith(".bak")
    assert quick_check(copy) == "ok"
    assert revision_of(copy) == "0008"  # taken before 0009 ran
    assert revision_of(folder / "project.db") == head_revision()


def test_a_new_project_and_a_current_one_take_no_backup(tmp_path, guard_0009):
    fresh = tmp_path / "fresh"
    fresh.mkdir()
    assert current_revision(fresh) is None
    open_project_db(fresh).dispose()
    current = at_revision(tmp_path / "current", "0009")
    open_project_db(current).dispose()
    assert latest_backup(fresh) is None and latest_backup(current) is None


def test_a_failed_backup_leaves_the_database_byte_identical_and_not_upgraded(tmp_path, guard_0009):
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("a file where the folder should be", "utf-8")
    before = sha256(folder / "project.db")
    with pytest.raises(BackupFailed) as err:
        open_project_db(folder)
    assert err.value.code == "backup_failed"
    assert sha256(folder / "project.db") == before
    assert revision_of(folder / "project.db") == "0008"


def test_a_copy_that_fails_quick_check_is_discarded_and_nothing_upgrades(tmp_path, guard_0009, monkeypatch):
    folder = at_revision(tmp_path / "old", "0008")
    before = sha256(folder / "project.db")
    monkeypatch.setattr(backup, "quick_check", lambda path: "*** in database main *** Page 3 is never used")
    with pytest.raises(BackupFailed, match="integrity check"):
        open_project_db(folder)
    assert sha256(folder / "project.db") == before
    assert list((folder / "backups").iterdir()) == []


def test_backups_are_kept_and_the_newest_is_found(tmp_path):
    folder = at_revision(tmp_path / "old", "0008")
    now = datetime(2026, 9, 26, 10, 15, tzinfo=UTC)
    first = backup_project_db(folder, now=now)
    second = backup_project_db(folder, now=now)
    third = backup_project_db(folder, now=now)
    assert len({first, second, third}) == 3 and all(p.exists() for p in (first, second, third))
    assert second.name == "project.db.v1-20260926T101500Z-2.bak"
    assert latest_backup(folder) == third
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_backup.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.migration'`.

- [ ] **Step 4: Write `app/migration/__init__.py` and `backup.py`**

`backend/app/migration/__init__.py`:

```python
"""Upgrading existing projects to the foundation schema (foundation spec §11).

Kept free of imports: `app.db.session` imports `app.migration.backup`, and the job modules import
the project registry, so anything imported here would be an import cycle.
"""
```

`backend/app/migration/backup.py`:

```python
"""Copy-first backup of a project database before a schema change (foundation spec §11.2).

`open_project_db` asks `needs_backup` before Alembic runs. When the upgrade will apply
`BACKUP_BEFORE`, it takes a backup with SQLite's own online backup API, which is consistent under
WAL. A backup that cannot be written, or that does not pass `PRAGMA quick_check`, raises
`BackupFailed`, and the upgrade does not run: the project's database is left exactly as it was.
The app never deletes a backup and never restores one by itself.

Only the standard library is imported here: `app.db.session` imports this module.
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

BACKUP_BEFORE = "0010"  # the foundation revision (foundation spec §11.1)
BACKUP_LABEL = "v1"  # the schema generation the copy holds
BACKUPS_DIR = "backups"
DB_NAME = "project.db"
_NAME = re.compile(r"^project\.db\.[A-Za-z0-9]+-(?P<stamp>\d{8}T\d{6}Z)(?:-(?P<n>\d+))?\.bak$")


class BackupFailed(Exception):
    """The copy could not be written or did not pass its check; nothing was upgraded."""

    code = "backup_failed"


def backups_dir(folder: Path) -> Path:
    return Path(folder) / BACKUPS_DIR


def needs_backup(current: str | None, script) -> bool:
    """True when upgrading from `current` to head will apply `BACKUP_BEFORE`.

    `current` None is a database with no revision yet (a new project): there is nothing to lose.
    A chain without `BACKUP_BEFORE`, or a revision this build does not know (a database written by
    a newer build), never asks for one; Alembic then reports the real problem itself.
    """
    if current is None or current == BACKUP_BEFORE:
        return False
    try:
        script.get_revision(BACKUP_BEFORE)
        pending = {rev.revision for rev in script.walk_revisions(base=current, head="heads")}
    except Exception:  # alembic raises ResolutionError or CommandError for an unknown id
        return False
    pending.discard(current)
    return BACKUP_BEFORE in pending


def quick_check(path: Path) -> str:
    """`PRAGMA quick_check` on a file opened read-only: "ok", or SQLite's first complaint."""
    con = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
    try:
        return str(con.execute("PRAGMA quick_check").fetchone()[0])
    finally:
        con.close()


def latest_backup(folder: Path) -> Path | None:
    """The newest backup in `<folder>/backups`, by its stamp and then its `-n` suffix."""
    found = []
    d = backups_dir(folder)
    if d.is_dir():
        for p in d.iterdir():
            m = _NAME.match(p.name)
            if m and p.is_file():
                found.append(((m["stamp"], int(m["n"] or 1)), p))
    return max(found)[1] if found else None


def _target(folder: Path, now: datetime) -> Path:
    stem = f"{DB_NAME}.{BACKUP_LABEL}-{now.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    path, n = backups_dir(folder) / f"{stem}.bak", 2
    while path.exists() or path.with_name(path.name + ".partial").exists():
        path, n = backups_dir(folder) / f"{stem}-{n}.bak", n + 1
    return path


def _discard(partial: Path | None) -> None:
    if partial is not None:
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass


def backup_project_db(folder: Path, now: datetime | None = None) -> Path:
    """Write and check `<folder>/backups/project.db.v1-<UTC stamp>.bak`; raise BackupFailed."""
    folder = Path(folder)
    partial: Path | None = None
    try:
        backups_dir(folder).mkdir(exist_ok=True)
        target = _target(folder, now or datetime.now(UTC))
        partial = target.with_name(target.name + ".partial")
        src = sqlite3.connect(folder / DB_NAME)
        try:
            src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            dst = sqlite3.connect(partial)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        verdict = quick_check(partial)
        if verdict != "ok":
            raise BackupFailed(f"The backup copy failed its integrity check ({verdict}).")
        os.replace(partial, target)
        return target
    except BackupFailed:
        _discard(partial)
        raise
    except (OSError, sqlite3.Error) as e:
        _discard(partial)
        raise BackupFailed(f"The project database could not be backed up: {e}") from e
```

- [ ] **Step 5: Rewrite `app/db/session.py`**

Replace the whole file with:

```python
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.migration.backup import backup_project_db, needs_backup

MIGRATIONS = Path(__file__).parent / "migrations"


def _db_url(folder: Path) -> str:
    return f"sqlite:///{(folder / 'project.db').as_posix()}"


def alembic_config(folder: Path | None = None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", _db_url(folder))
    return cfg


def project_script() -> ScriptDirectory:
    return ScriptDirectory.from_config(alembic_config())


def head_revision() -> str:
    return project_script().get_current_head()


def current_revision(folder: Path) -> str | None:
    """The database's Alembic revision, read without the WAL pragma; None for a missing or new file."""
    if not (Path(folder) / "project.db").exists():
        return None
    probe = create_engine(_db_url(Path(folder)), poolclass=NullPool)
    try:
        with probe.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        probe.dispose()


def open_project_db(folder: Path):
    """Create the engine for a project folder and bring its schema to head.

    Copy-first (foundation spec §11.2): when the upgrade will apply the foundation revision, the
    database is backed up before Alembic runs, and a failed backup raises `BackupFailed` with the
    database untouched. Every path that opens a project comes through here.
    """
    folder = Path(folder)
    if needs_backup(current_revision(folder), project_script()):
        backup_project_db(folder)
    engine = create_engine(_db_url(folder), future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = alembic_config(folder)
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    return engine


def make_session_factory(engine):
    return sessionmaker(engine, class_=Session, expire_on_commit=False, future=True)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_backup.py tests/test_migration_0008.py tests/test_migration_0009.py tests/test_db.py tests/test_projects.py -v`
Expected: all pass. The existing migration and project tests prove that the new probe changed nothing for a current database.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/migration/__init__.py backend/app/migration/backup.py backend/app/db/session.py backend/tests/migration_helpers.py backend/tests/test_migration_backup.py
git commit -m "feat(migration): copy-first backup before the foundation revision runs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `migrations.json`, the per-project upgrade state

**Files:**
- Create: `backend/app/migration/state.py`
- Test: `backend/tests/test_migration_state.py`

**Interfaces:**
- Consumes: `app.errors.AppError`.
- Produces:
  - `MigrationStates(data_dir: Path)` with:
    - `.path`
    - `.key(folder) -> str`
    - `.locked()` (a context manager over one process-wide `RLock`)
    - `.all() -> dict[str, dict]`
    - `.get(folder) -> dict | None`
    - `.set(folder, **fields) -> dict`
  - Allowed fields: `state` (`pending | running | ok | failed`), `job_id`, `error`, `code`, `step`, `backup_path`, `report_path`, `project_id`. `set` adds `folder` and `updated_at`.
  - `failed_error(entry: dict) -> AppError`: 409 `project_upgrade_failed`, `{error, backup_path}`.
  - `upgrading_error(job_id: str | None, reason: str | None = None) -> AppError`: 409 `project_upgrading`, `{job_id}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_state.py`:

```python
"""migrations.json (foundation spec §11.3): keyed by the lower-cased folder, atomic, never fatal."""

import json
import threading
from pathlib import Path

import pytest

from app.migration.state import FILE_NAME, MigrationStates, failed_error, upgrading_error


def test_entries_are_keyed_by_the_lower_cased_resolved_folder(tmp_path):
    folder = tmp_path / "Projects" / "AHTest"
    folder.mkdir(parents=True)
    states = MigrationStates(tmp_path / "appdata")
    states.set(folder, state="failed", code="backup_failed", error="disk full")
    same = Path(str(folder).upper())
    got = states.get(same)
    assert got["state"] == "failed" and got["code"] == "backup_failed" and got["error"] == "disk full"
    assert got["folder"] == str(folder.resolve()) and got["updated_at"]
    assert list(states.all()) == [str(folder.resolve()).lower()]


def test_set_merges_into_the_existing_entry(tmp_path):
    states = MigrationStates(tmp_path)
    states.set(tmp_path / "p", state="pending", job_id="j1", project_id="p1")
    states.set(tmp_path / "p", state="ok", error=None)
    got = states.get(tmp_path / "p")
    assert (got["state"], got["job_id"], got["project_id"], got["error"]) == ("ok", "j1", "p1", None)


def test_unknown_fields_and_states_are_refused(tmp_path):
    states = MigrationStates(tmp_path)
    with pytest.raises(ValueError, match="stat"):
        states.set(tmp_path / "p", stat="ok")
    with pytest.raises(ValueError, match="upgrading"):
        states.set(tmp_path / "p", state="upgrading")


def test_a_damaged_file_reads_as_empty_and_is_logged(tmp_path, caplog):
    (tmp_path / FILE_NAME).write_text("{ not json", "utf-8")
    states = MigrationStates(tmp_path)
    assert states.all() == {} and states.get(tmp_path / "p") is None
    assert FILE_NAME in caplog.text
    states.set(tmp_path / "p", state="ok")  # a write replaces the damaged file
    assert json.loads((tmp_path / FILE_NAME).read_text("utf-8"))


def test_writes_leave_no_temporary_files(tmp_path):
    states = MigrationStates(tmp_path)
    for i in range(5):
        states.set(tmp_path / f"p{i}", state="ok")
    assert sorted(p.name for p in tmp_path.iterdir()) == [FILE_NAME]


def test_concurrent_writers_lose_nothing(tmp_path):
    states = MigrationStates(tmp_path)

    def write(n):
        for i in range(25):
            states.set(tmp_path / f"t{n}-{i}", state="pending", job_id=f"{n}-{i}")

    threads = [threading.Thread(target=write, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(MigrationStates(tmp_path).all()) == 200


def test_the_409s_carry_the_contract_details():
    failed = failed_error({"error": "step 2 failed", "backup_path": "C:/p/backups/x.bak"})
    assert (failed.code, failed.status) == ("project_upgrade_failed", 409)
    assert failed.details == {"error": "step 2 failed", "backup_path": "C:/p/backups/x.bak"}
    upgrading = upgrading_error("job-1")
    assert (upgrading.code, upgrading.status, upgrading.details) == ("project_upgrading", 409, {"job_id": "job-1"})
    assert "model library" in upgrading_error(None, "Waiting for the model library.").message
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_state.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.migration.state'`.

- [ ] **Step 3: Write `app/migration/state.py`**

```python
"""`migrations.json`: each project's upgrade state, keyed by its lower-cased folder (spec §11.3).

It lives in the app-data folder beside `recent_projects.json`, so a project that cannot be opened
still has a state to show. Stored states are `pending`, `ok` and `failed`; `running` is derived
by the gate from a live job. Every write is atomic (temp file + replace) and serialised by one
process-wide lock. A file that cannot be read is treated as empty and logged, never raised: the
app must start even when this file is damaged (AGENTS.md).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.errors import AppError

FILE_NAME = "migrations.json"
STATES = ("pending", "running", "ok", "failed")
FIELDS = {"state", "job_id", "error", "code", "step", "backup_path", "report_path", "project_id"}
log = logging.getLogger(__name__)


class MigrationStates:
    _lock = threading.RLock()  # one file per app-data folder, one process: one lock is enough

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / FILE_NAME

    @staticmethod
    def key(folder) -> str:
        return str(Path(folder).resolve()).lower()

    @contextmanager
    def locked(self):
        """Hold the lock across a read-decide-write sequence (submit, retry)."""
        with self._lock:
            yield self

    def all(self) -> dict[str, dict]:
        with self._lock:
            if not self.path.exists():
                return {}
            try:
                data = json.loads(self.path.read_text("utf-8"))
            except (OSError, ValueError):
                log.exception("%s could not be read; treating it as empty", self.path)
                return {}
            return data if isinstance(data, dict) else {}

    def get(self, folder) -> dict | None:
        entry = self.all().get(self.key(folder))
        return dict(entry) if isinstance(entry, dict) else None

    def set(self, folder, **fields) -> dict:
        unknown = set(fields) - FIELDS
        if unknown:
            raise ValueError(f"unknown migration state fields: {sorted(unknown)}")
        if "state" in fields and fields["state"] not in STATES:
            raise ValueError(f"unknown migration state {fields['state']!r}")
        with self._lock:
            data = self.all()
            key = self.key(folder)
            entry = dict(data.get(key) or {})
            entry.update(fields)
            entry["folder"] = str(Path(folder).resolve())
            entry["updated_at"] = datetime.now(UTC).isoformat()
            data[key] = entry
            self._write(data)
            return dict(entry)

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_text(json.dumps(data, indent=2), "utf-8")
        os.replace(tmp, self.path)


def failed_error(entry: dict) -> AppError:
    """409 `project_upgrade_failed` (foundation spec §11.3): the error and where the backup is."""
    error = entry.get("error") or "unknown error"
    return AppError(
        "project_upgrade_failed",
        f"This project could not be upgraded: {error}",
        409,
        {"error": error, "backup_path": entry.get("backup_path")},
    )


def upgrading_error(job_id: str | None, reason: str | None = None) -> AppError:
    """409 `project_upgrading` (foundation spec §11.3): no project route runs on half-migrated data."""
    message = reason or "This project is being upgraded. It opens when the upgrade finishes."
    return AppError("project_upgrading", message, 409, {"job_id": job_id})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_state.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/state.py backend/tests/test_migration_state.py
git commit -m "feat(migration): migrations.json records each project's upgrade state" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The step ledger and the resumable pipeline

**Files:**
- Create: `backend/app/migration/ledger.py`, `backend/app/migration/pipeline.py`, `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_pipeline.py`

**Interfaces:**
- Consumes:
  - `app.migration.backup.backups_dir`, `latest_backup` (Task 1)
  - `app.jobs.cancellation.JobCancelled`
  - `tests/migration_helpers.open_handle`, `legacy_at_head` (Task 1)
- Produces:
  - `ledger.done_steps(s: Session) -> set[str]`, `ledger.record(s: Session, name: str, detail: dict) -> None`
  - `pipeline`:
    - `TARGET_SCHEMA_VERSION = 2`, `REPORT_NAME = "migration-v2.json"`, `FINISH = "finish"`
    - `@dataclass MigrationEnv(library, catalogue, origin_folder: Path, log: logging.Logger, progress=…, check_cancelled=…)`
    - `@dataclass StepContext(handle, session: Session, env: MigrationEnv)`
    - `@dataclass(frozen=True) Step(name: str, label: str, run: Callable[[StepContext], dict | None])`
    - `class StepFailed(Exception)` with `.step`, `.cause`, `.message`
    - `run_pipeline(handle, env, steps) -> dict`: the report, with `steps`, `warnings`, `seconds`, `backup_path` and `report_path`
    - `finish(handle, report) -> Path`
  - `steps.PIPELINE: tuple[Step, ...] = ()`
  - The step contract, which Part B follows: a step's `run` does its project writes in `ctx.session`. Its return value is recorded in the same transaction. A `warnings: list[str]` key in it is collected into the report. A step that writes other databases (catalogue, library) must be idempotent on its own, because those writes commit separately.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_pipeline.py`:

```python
"""The resumable step pipeline (foundation spec §11.4, §16: idempotent, kill between steps, resume)."""

import json
import logging

import pytest
from migration_helpers import legacy_at_head, open_handle
from sqlalchemy import text

from app.jobs.cancellation import JobCancelled
from app.migration.pipeline import REPORT_NAME, MigrationEnv, Step, StepFailed, run_pipeline


def _steps(calls, fail_at=None, cancel_at=None):
    def make(name):
        def run(ctx):
            calls.append(name)
            ctx.session.execute(text("INSERT INTO scratch (name) VALUES (:n)"), {"n": name})
            if name == fail_at:
                raise RuntimeError("the disk is full")
            if name == cancel_at:
                raise JobCancelled()
            return {"wrote": name, "warnings": ["saw something odd"] if name == "b" else []}

        return Step(name, f"Step {name}", run)

    return tuple(make(n) for n in ("a", "b", "c"))


@pytest.fixture
def handle(tmp_path):
    h = open_handle(legacy_at_head(tmp_path / "p"))
    with h.session() as s:
        s.execute(text("CREATE TABLE scratch (name TEXT)"))
    yield h
    h.engine.dispose()


def _env(handle, progress=None, check_cancelled=None):
    return MigrationEnv(
        library=None,
        catalogue=None,
        origin_folder=handle.folder,
        log=logging.getLogger("test.migration"),
        progress=progress or (lambda fraction, message="": None),
        check_cancelled=check_cancelled or (lambda: None),
    )


def _read(handle, sql):
    with handle.session() as s:
        return list(s.execute(text(sql)).scalars())


def test_steps_run_in_order_are_recorded_and_the_project_finishes(handle):
    calls, seen = [], []
    report = run_pipeline(handle, _env(handle, progress=lambda f, m="": seen.append(m)), _steps(calls))
    assert calls == ["a", "b", "c"]
    assert sorted(_read(handle, "SELECT name FROM migration_step")) == ["a", "b", "c", "finish"]
    assert _read(handle, "SELECT schema_version FROM project") == [2]
    assert report["warnings"] == ["b: saw something odd"]
    assert [s["name"] for s in report["steps"]] == ["a", "b", "c"]
    written = json.loads((handle.folder / "backups" / REPORT_NAME).read_text("utf-8"))
    assert written["steps"][1]["detail"]["wrote"] == "b" and written["seconds"] >= 0
    assert seen[:3] == ["Step a", "Step b", "Step c"]


def test_a_failed_step_names_itself_rolls_back_and_stops(handle):
    calls = []
    with pytest.raises(StepFailed) as err:
        run_pipeline(handle, _env(handle), _steps(calls, fail_at="b"))
    assert err.value.step == "b" and err.value.message == "the disk is full"
    assert calls == ["a", "b"]
    assert _read(handle, "SELECT name FROM scratch") == ["a"]  # b's own write rolled back
    assert _read(handle, "SELECT name FROM migration_step") == ["a"]
    assert _read(handle, "SELECT schema_version FROM project") == [1]
    assert not (handle.folder / "backups" / REPORT_NAME).exists()


def test_a_rerun_resumes_at_the_first_unrecorded_step(handle):
    with pytest.raises(StepFailed):
        run_pipeline(handle, _env(handle), _steps([], fail_at="b"))
    calls = []
    report = run_pipeline(handle, _env(handle), _steps(calls))
    assert calls == ["b", "c"]
    assert report["steps"][0] == {"name": "a", "skipped": True}
    assert _read(handle, "SELECT name FROM scratch ORDER BY rowid") == ["a", "b", "c"]


def test_a_cancel_between_steps_resumes_later(handle):
    with pytest.raises(JobCancelled):
        run_pipeline(handle, _env(handle), _steps([], cancel_at="b"))
    calls = []
    run_pipeline(handle, _env(handle), _steps(calls))
    assert calls == ["b", "c"]


def test_cancellation_is_checked_before_every_step(handle):
    checks = []

    def check():
        checks.append(1)
        if len(checks) == 2:
            raise JobCancelled()

    calls = []
    with pytest.raises(JobCancelled):
        run_pipeline(handle, _env(handle, check_cancelled=check), _steps(calls))
    assert calls == ["a"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_pipeline.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.migration.pipeline'`.

- [ ] **Step 3: Write `ledger.py`, `pipeline.py` and `steps.py`**

`backend/app/migration/ledger.py`:

```python
"""The step ledger: `migration_step(name, done_at, detail)` in the project database (spec §11.4).

Plain SQL on purpose: the table and its ORM class belong to unit BC (revision 0010), and the
ledger needs only its three columns. A step records itself in the same transaction as its own
project writes, so a step is either done and recorded, or not done at all.
"""

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

TABLE = "migration_step"


def done_steps(s: Session) -> set[str]:
    return set(s.execute(text(f"SELECT name FROM {TABLE}")).scalars())


def record(s: Session, name: str, detail: dict) -> None:
    s.execute(
        text(f"INSERT OR REPLACE INTO {TABLE} (name, done_at, detail) VALUES (:name, :done_at, :detail)"),
        {
            "name": name,
            "done_at": datetime.now(UTC).replace(tzinfo=None).isoformat(sep=" "),
            "detail": json.dumps(detail, default=str),
        },
    )
```

`backend/app/migration/pipeline.py`:

```python
"""Running the migration's data steps in order, resumably (foundation spec §11.4).

`run_pipeline` skips every step the ledger already records, and runs each remaining step in one
project transaction together with its ledger record. It ends with `finish`: the report
`<project>/backups/migration-v2.json` is written first, then `project.schema_version = 2` and the
`finish` record commit together. A failure raises `StepFailed` naming the step; nothing after it
runs, and a later run starts from that step.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.jobs.cancellation import JobCancelled
from app.migration import ledger
from app.migration.backup import backups_dir, latest_backup

TARGET_SCHEMA_VERSION = 2
REPORT_NAME = "migration-v2.json"
FINISH = "finish"


def _no_progress(fraction: float, message: str = "") -> None:
    return None


def _never_cancelled() -> None:
    return None


@dataclass
class MigrationEnv:
    """What steps reach besides the project: the app-wide stores, the folder that holds the
    project's files (the original folder, also when a dry run works on a copied database), and
    the job's progress and cancellation."""

    library: Any
    catalogue: Any
    origin_folder: Path
    log: logging.Logger
    progress: Callable[[float, str], None] = _no_progress
    check_cancelled: Callable[[], None] = _never_cancelled


@dataclass
class StepContext:
    handle: Any
    session: Session
    env: MigrationEnv


@dataclass(frozen=True)
class Step:
    name: str
    label: str
    run: Callable[[StepContext], dict | None]


class StepFailed(Exception):
    def __init__(self, step: str, cause: BaseException):
        message = getattr(cause, "message", None) or str(cause) or type(cause).__name__
        super().__init__(f"{step}: {message}")
        self.step, self.cause, self.message = step, cause, message


def run_pipeline(handle, env: MigrationEnv, steps) -> dict:
    """Run every unrecorded step, then `finish`. Returns the report that `finish` wrote."""
    started = time.monotonic()
    with handle.session() as s:
        done = ledger.done_steps(s)
    report: dict = {
        "project_id": handle.id,
        "folder": str(env.origin_folder),
        "started_at": datetime.now(UTC).isoformat(),
        "steps": [],
        "warnings": [],
    }
    total = len(steps) + 1
    for i, step in enumerate(steps):
        env.check_cancelled()
        if step.name in done:
            report["steps"].append({"name": step.name, "skipped": True})
            continue
        env.progress(i / total, step.label)
        t0 = time.monotonic()
        try:
            with handle.session() as s:
                detail = step.run(StepContext(handle, s, env)) or {}
                ledger.record(s, step.name, detail)
        except JobCancelled:
            raise
        except Exception as e:
            env.log.exception("migration step %s failed for %s", step.name, handle.folder)
            raise StepFailed(step.name, e) from e
        report["warnings"] += [f"{step.name}: {w}" for w in detail.get("warnings", [])]
        report["steps"].append(
            {"name": step.name, "skipped": False, "seconds": round(time.monotonic() - t0, 3), "detail": detail}
        )
    env.progress((total - 1) / total, "Finishing the upgrade")
    report["seconds"] = round(time.monotonic() - started, 3)
    finish(handle, report)
    return report


def finish(handle, report: dict) -> Path:
    """Write the report, then set `schema_version = 2` and record `finish` in one transaction."""
    path = backups_dir(handle.folder) / REPORT_NAME
    backup = latest_backup(handle.folder)
    report["backup_path"] = str(backup) if backup else None
    report["report_path"] = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(report, indent=2, default=str), "utf-8")
    os.replace(tmp, path)
    with handle.session() as s:
        s.execute(text("UPDATE project SET schema_version = :v"), {"v": TARGET_SCHEMA_VERSION})
        ledger.record(s, FINISH, {"report": REPORT_NAME})
    return path
```

`backend/app/migration/steps.py`:

```python
"""The migration's data steps (foundation spec §11.4), in order.

Empty until unit MG-steps lands. With no steps the orchestration is **disarmed**
(`app.migration.job.armed()` is False): nothing is submitted, no project is gated, and no project
is marked upgraded before its data has actually been migrated.
"""

from app.migration.pipeline import Step

PIPELINE: tuple[Step, ...] = ()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_pipeline.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/ledger.py backend/app/migration/pipeline.py backend/app/migration/steps.py backend/tests/test_migration_pipeline.py
git commit -m "feat(migration): a step ledger and a resumable pipeline, shipped with no steps" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Invariants and the dry-run script

**Files:**
- Create: `backend/app/migration/invariants.py`, `backend/scripts/migration_dry_run.py`
- Modify: `backend/pyproject.toml` (`markers`)
- Test: `backend/tests/test_migration_dry_run.py`, `backend/tests/test_migration_real.py`

**Interfaces:**
- Consumes:
  - `open_project_db`, `current_revision`, `head_revision`, `project_script` (Task 1)
  - `needs_backup`, `latest_backup`, `quick_check` (Task 1)
  - `run_pipeline`, `MigrationEnv`, `StepFailed`, `TARGET_SCHEMA_VERSION` (Task 3)
  - `steps.PIPELINE`
  - `app.library.handle.open_library`
- Produces:
  - `invariants.snapshot(db: Path) -> {"rows": {table: n}, "totals": {"table.column": n}}`
  - `invariants.compare(before, after) -> list[str]`
  - The script module (loaded with `migration_helpers.load_script("migration_dry_run")`):
    - `default_data_dir() -> Path`
    - `recent_folders(data_dir) -> list[Path]`
    - `fingerprint(folder) -> dict[str, str | None]`
    - `open_stores(appdata: Path) -> tuple[library, catalogue | None]` (Part B fills in the catalogue)
    - `project_checks(handle) -> dict` (Part B fills this in; `{}` in Part A)
    - `dry_run_one(folder, dest, library, catalogue) -> dict`
    - `dry_run(folders, data_dir, work) -> dict`
    - `print_report(report) -> None`
    - `main(argv: list[str] | None = None) -> int`
  - Per-project result keys: `folder`, `ok`, `error`, `revision_before`, `revision_after`, `backup_expected`, `backup`, `schema_version_after`, `steps`, `warnings`, `mismatches`, `checks`, `originals_unchanged`, `seconds`.
  - Report keys: `armed`, `head`, `data_dir`, `ok`, `projects`, `stores`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_dry_run.py`:

```python
"""The dry run over copies of project folders (foundation spec §11.5)."""

import json
import sqlite3
from pathlib import Path

import pytest
from migration_helpers import (
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    at_revision,
    load_script,
    revision_of,
)

from app.db.session import head_revision
from app.migration import backup
from app.migration.invariants import compare, snapshot


@pytest.fixture
def mod():
    return load_script("migration_dry_run")


@pytest.fixture
def real_like(tmp_path, monkeypatch):
    """Two folders shaped like the operator's: one at 0001 (E:\\Projects\\Ahmadia) and one at 0008 with
    boxes, runs and a materialised dataset, listed in an app-data folder's recent list."""
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    old = at_revision(tmp_path / "projects" / "old", "0001", name="Old")
    busy = at_revision(tmp_path / "projects" / "busy", "0008", name="Busy")
    add_images_and_boxes(busy)
    add_detect_rows(busy)
    add_dataset(busy)
    data_dir = tmp_path / "appdata"
    data_dir.mkdir()
    recent = [{"id": "p-busy", "name": "Busy", "folder": str(busy)}]
    (data_dir / "recent_projects.json").write_text(json.dumps(recent), "utf-8")
    return data_dir, old, busy


def test_snapshot_totals_sum_every_count_shape(tmp_path):
    folder = at_revision(tmp_path / "p", "0008")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    snap = snapshot(folder / "project.db")
    assert snap["rows"]["box"] == 10 and snap["rows"]["map_detection"] == 4
    assert snap["totals"]["map_run.counts"] == 4
    assert snap["totals"]["map_run.area_counts"] == 4  # 2+1 totals and 1+0 verified
    assert compare(snap, snap) == []
    moved = {"rows": dict(snap["rows"], box=9), "totals": snap["totals"]}
    assert compare(snap, moved) == ["box: 10 before, 9 after"]


def test_the_dry_run_upgrades_copies_and_never_touches_the_originals(mod, real_like, tmp_path):
    data_dir, old, busy = real_like
    before = {f: mod.fingerprint(f) for f in (old, busy)}
    report = mod.dry_run(mod.recent_folders(data_dir) + [old], data_dir, tmp_path / "work")
    assert report["ok"], report
    assert [Path(p["folder"]) for p in report["projects"]] == [busy, old]
    for p in report["projects"]:
        assert p["originals_unchanged"] and p["mismatches"] == [], p
        assert p["revision_after"] == head_revision() and p["backup_expected"]
        assert p["backup"]["quick_check"] == "ok"
    assert {f: mod.fingerprint(f) for f in (old, busy)} == before
    assert revision_of(busy / "project.db") == "0008" and revision_of(old / "project.db") == "0001"
    assert not (busy / "backups").exists()


def test_rows_still_in_the_wal_are_copied(mod, tmp_path):
    folder = at_revision(tmp_path / "live", "0009")
    add_images_and_boxes(folder)
    live = sqlite3.connect(folder / "project.db")  # the "running app": its writes sit in -wal
    try:
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("PRAGMA wal_autocheckpoint=0")
        live.execute("UPDATE box SET review_state = 'accepted' WHERE review_state = 'unreviewed'")
        live.execute(
            "INSERT INTO box (id, image_id, class_id, x, y, w, h, provenance_kind, review_state, created_at)"
            " VALUES ('b-late', 'i1', 'c-exc', 1, 1, 2, 2, 'person', 'accepted', '2026-02-01 00:00:00.000000')"
        )
        live.commit()
        assert (folder / "project.db-wal").exists()
        result = mod.dry_run_one(folder, tmp_path / "work" / "p", *mod.open_stores(tmp_path / "appdata"))
    finally:
        live.close()
    assert result["ok"], result
    copied = sqlite3.connect(tmp_path / "work" / "p" / "project.db")
    try:
        assert copied.execute("SELECT COUNT(*) FROM box").fetchone()[0] == 11
    finally:
        copied.close()


def test_a_broken_project_fails_alone_and_the_exit_code_says_so(mod, real_like, tmp_path, capsys):
    data_dir, _old, busy = real_like
    broken = tmp_path / "projects" / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 100)
    out = tmp_path / "report.json"
    code = mod.main(
        ["--data-dir", str(data_dir), "--recent", "--folders", str(broken), "--work-dir",
         str(tmp_path / "work"), "--out", str(out)]
    )
    assert code == 1
    by_name = {Path(p["folder"]).name: p for p in json.loads(out.read_text("utf-8"))["projects"]}
    assert by_name["busy"]["ok"] and not by_name["broken"]["ok"] and by_name["broken"]["error"]
    printed = capsys.readouterr().out
    assert "[FAILED]" in printed and "[ok]" in printed


def test_a_folder_listed_twice_runs_once_and_an_empty_run_is_not_a_pass(mod, real_like, tmp_path):
    data_dir, _old, busy = real_like
    report = mod.dry_run([busy, Path(str(busy).upper())], data_dir, tmp_path / "work")
    assert len(report["projects"]) == 1
    assert mod.dry_run([], data_dir, tmp_path / "empty")["ok"] is False
```

Create `backend/tests/test_migration_real.py`:

```python
"""The dry run over the operator's real project folders (foundation spec §11.5).

Opt-in: set KESTREL_REAL_PROJECTS to the folders, separated by ';' (os.pathsep on Windows), and
optionally KESTREL_REAL_DATA_DIR to the app-data folder (default: the installed app's). It is
skipped otherwise. Everything runs on copies in a temp folder; the originals are only read.
"""

import os
from pathlib import Path

import pytest
from migration_helpers import load_script

pytestmark = pytest.mark.real_data
FOLDERS = [Path(p) for p in os.environ.get("KESTREL_REAL_PROJECTS", "").split(os.pathsep) if p.strip()]


@pytest.mark.skipif(not FOLDERS, reason="KESTREL_REAL_PROJECTS is not set")
def test_every_real_project_upgrades_on_a_copy(tmp_path):
    mod = load_script("migration_dry_run")
    data_dir = Path(os.environ.get("KESTREL_REAL_DATA_DIR") or mod.default_data_dir())
    report = mod.dry_run(FOLDERS, data_dir, tmp_path)
    failures = [(p["folder"], p["error"], p["mismatches"]) for p in report["projects"] if not p["ok"]]
    assert not failures, failures
    assert all(p["originals_unchanged"] for p in report["projects"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_dry_run.py tests/test_migration_real.py -v`
Expected: FAIL. `test_migration_dry_run.py` fails at collection with `ModuleNotFoundError: No module named 'app.migration.invariants'`, and pytest warns `Unknown pytest.mark.real_data`.

- [ ] **Step 3: Register the marker**

In `backend/pyproject.toml`, `[tool.pytest.ini_options].markers`, add after the `potreeconverter` line:

```toml
    "real_data: runs the migration dry run on the operator's real project folders (KESTREL_REAL_PROJECTS); skipped when unset",
```

- [ ] **Step 4: Write `app/migration/invariants.py`**

```python
"""Numbers the migration must not change (foundation spec §16: row counts, and the counts and
area-count totals equal before and after). Read with plain sqlite3, so they work on a database at
any revision; only tables present before are compared.
"""

import json
import sqlite3
from pathlib import Path

ROW_TABLES = (
    "source", "image", "box", "dataset", "dataset_image", "model", "job", "geo_map", "map_run",
    "map_detection", "map_zone", "map_label", "query_run", "site_area", "point_cloud",
    "cloud_measurement", "surface", "volume_measurement",
)
JSON_TOTALS = {
    "query_run": ("counts", "verified_counts"),
    "map_run": ("counts", "verified_counts", "area_counts"),
}


def _total(value) -> float:
    """Sum every number in a JSON value: {class: n} or {area: {class: {total, verified}}}."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int | float):
        return value
    if isinstance(value, dict):
        return sum(_total(v) for v in value.values())
    return 0


def snapshot(db: Path) -> dict:
    con = sqlite3.connect(db)
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        rows = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ROW_TABLES if t in tables}
        totals = {}
        for table, columns in JSON_TOTALS.items():
            if table not in tables:
                continue
            present = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
            for column in columns:
                if column in present:
                    values = con.execute(f"SELECT {column} FROM {table}").fetchall()
                    totals[f"{table}.{column}"] = sum(_total(json.loads(v or "{}")) for (v,) in values)
        return {"rows": rows, "totals": totals}
    finally:
        con.close()


def compare(before: dict, after: dict) -> list[str]:
    problems = []
    for group in ("rows", "totals"):
        for key, n in before[group].items():
            m = after[group].get(key)
            if m != n:
                problems.append(f"{key}: {n} before, {m} after")
    return problems
```

- [ ] **Step 5: Write `scripts/migration_dry_run.py`**

Use the Write tool (the docstring holds Windows paths):

```python
"""Dry-run the foundation migration on copies of real project folders (foundation spec §11.5).

Nothing original is opened for writing. For each project folder the script copies `project.db`
(and its `-wal`/`-shm`) into a temporary folder, copies the app's `library.db` and `catalogue.db`
beside them, then runs the copy-first backup, the schema upgrade and every data step against the
copies, as the `project_migrate` job would, but in this process with no job runner. It prints
what each project went through and exits 1 if a project failed, a before/after invariant moved,
a backup was missing or bad, or an original file changed.

Close Kestrel AI first: a running app may be writing the originals' `-wal` while they are copied.

Usage (from backend\\):
  E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe scripts\\migration_dry_run.py --recent
      --folders E:\\Projects\\Ahmadia --out ..\\docs\\evidence\\foundation-migration\\dry-run.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select  # noqa: E402

from app.db.models import Project  # noqa: E402
from app.db.session import current_revision, head_revision, open_project_db, project_script  # noqa: E402
from app.migration import steps  # noqa: E402
from app.migration.backup import latest_backup, needs_backup, quick_check  # noqa: E402
from app.migration.invariants import compare, snapshot  # noqa: E402
from app.migration.pipeline import TARGET_SCHEMA_VERSION, MigrationEnv, StepFailed, run_pipeline  # noqa: E402
from app.projects.service import ProjectHandle  # noqa: E402

DB_FILES = ("project.db", "project.db-wal", "project.db-shm")
STORE_FILES = ("library.db", "catalogue.db")
log = logging.getLogger("migration_dry_run")


def default_data_dir() -> Path:
    """The installed app's data folder: `APP_DATA_DIR` as the launcher sets it, else Tauri's."""
    if os.environ.get("APP_DATA_DIR"):
        return Path(os.environ["APP_DATA_DIR"])
    roaming = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return roaming / "ai.synapse-solutions.kestrel-ai"


def recent_folders(data_dir: Path) -> list[Path]:
    path = Path(data_dir) / "recent_projects.json"
    if not path.exists():
        return []
    items = json.loads(path.read_text("utf-8"))
    return [Path(r["folder"]) for r in items if isinstance(r, dict) and r.get("folder")]


def fingerprint(folder: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for name in DB_FILES:
        p = Path(folder) / name
        if p.is_file():
            with p.open("rb") as f:
                out[name] = hashlib.file_digest(f, "sha256").hexdigest()
        else:
            out[name] = None
    return out


def copy_app_stores(data_dir: Path, work: Path) -> Path:
    """Copy library.db and catalogue.db (with -wal/-shm) into `<work>/appdata/library`."""
    appdata = work / "appdata"
    lib = appdata / "library"
    lib.mkdir(parents=True, exist_ok=True)
    for db in STORE_FILES:
        for suffix in ("", "-wal", "-shm"):
            src = Path(data_dir) / "library" / f"{db}{suffix}"
            if src.is_file():
                shutil.copy2(src, lib / src.name)
    return appdata


def open_stores(appdata: Path):
    """The library (and, once unit BC has landed, the catalogue) opened on the copies."""
    from app.library.handle import open_library

    return open_library(appdata), None


def project_checks(handle) -> dict:
    """Per-project facts the merge gate reads once the steps exist (Part B fills this in)."""
    return {}


def _handle(dest: Path, engine) -> ProjectHandle:
    from app.db.session import make_session_factory

    with make_session_factory(engine)() as s:
        row = s.execute(select(Project)).scalar_one()
        handle = ProjectHandle(row.id, dest, engine)
        handle.schema_version = row.schema_version
    return handle


def _print_progress(fraction: float, message: str = "") -> None:
    print(f"      {fraction * 100:5.1f}%  {message}", flush=True)


def dry_run_one(folder: Path, dest: Path, library, catalogue) -> dict:
    folder = Path(folder)
    result: dict = {"folder": str(folder), "ok": False, "error": None, "steps": [], "warnings": [],
                    "mismatches": [], "checks": {}, "backup": None}
    t0 = time.monotonic()
    before_hash = fingerprint(folder)
    engine = None
    try:
        if before_hash["project.db"] is None:
            raise FileNotFoundError(f"{folder} has no project.db")
        dest.mkdir(parents=True)
        for name in DB_FILES:
            if (folder / name).is_file():
                shutil.copy2(folder / name, dest / name)
        result["revision_before"] = current_revision(dest)
        result["backup_expected"] = needs_backup(result["revision_before"], project_script())
        before = snapshot(dest / "project.db")
        engine = open_project_db(dest)
        result["revision_after"] = current_revision(dest)
        backup = latest_backup(dest)
        if backup is not None:
            result["backup"] = {"path": str(backup), "quick_check": quick_check(backup)}
        handle = _handle(dest, engine)
        if steps.PIPELINE and handle.schema_version < TARGET_SCHEMA_VERSION:
            env = MigrationEnv(library=library, catalogue=catalogue, origin_folder=folder, log=log,
                               progress=_print_progress)
            report = run_pipeline(handle, env, steps.PIPELINE)
            result["steps"], result["warnings"] = report["steps"], report["warnings"]
        with handle.session() as s:
            result["schema_version_after"] = handle.row(s).schema_version
        result["checks"] = project_checks(handle) if steps.PIPELINE else {}
        engine.dispose()
        engine = None
        result["mismatches"] = compare(before, snapshot(dest / "project.db"))
        backup_good = result["backup"] is not None and result["backup"]["quick_check"] == "ok"
        result["ok"] = not result["mismatches"] and (backup_good or not result["backup_expected"])
        if result["backup_expected"] and not backup_good:
            result["error"] = "the backup is missing or failed its check"
    except StepFailed as e:
        result["error"] = f"step {e.step} failed: {e.message}"
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        if engine is not None:
            engine.dispose()
        result["originals_unchanged"] = fingerprint(folder) == before_hash
        result["ok"] = bool(result["ok"] and result["originals_unchanged"])
        result["seconds"] = round(time.monotonic() - t0, 3)
    return result


def summarise_stores(library, catalogue) -> dict:
    """App-wide facts the merge gate reads once the steps exist (Part B fills this in)."""
    return {}


def dry_run(folders, data_dir: Path, work: Path) -> dict:
    unique, seen = [], set()
    for f in folders:
        key = str(Path(f).resolve()).lower()
        if key not in seen:
            seen.add(key)
            unique.append(Path(f))
    work.mkdir(parents=True, exist_ok=True)
    library, catalogue = open_stores(copy_app_stores(Path(data_dir), work))
    try:
        results = []
        for i, folder in enumerate(unique):
            print(f"-> {folder}", flush=True)
            results.append(dry_run_one(folder, work / f"project-{i:02d}", library, catalogue))
        stores = summarise_stores(library, catalogue)
    finally:
        for store in (library, catalogue):
            if store is not None:
                store.engine.dispose()
    return {
        "armed": bool(steps.PIPELINE),
        "head": head_revision(),
        "data_dir": str(data_dir),
        "ok": bool(results) and all(r["ok"] for r in results),
        "projects": results,
        "stores": stores,
    }


def print_report(report: dict) -> None:
    print(f"head {report['head']}  armed {report['armed']}  data {report['data_dir']}")
    for p in report["projects"]:
        tag = "[ok]" if p["ok"] else "[FAILED]"
        backup = (p.get("backup") or {}).get("quick_check", "none")
        print(f"{tag} {p['folder']}  {p.get('revision_before')} -> {p.get('revision_after')}"
              f"  v{p.get('schema_version_after')}  {p['seconds']} s  backup {backup}")
        for step in p["steps"]:
            detail = {k: v for k, v in (step.get("detail") or {}).items() if k != "warnings"}
            print(f"     {step['name']}{' (skipped)' if step.get('skipped') else ''}  {json.dumps(detail)}")
        for key, value in p["checks"].items():
            print(f"     check {key}: {value}")
        for w in p["warnings"]:
            print(f"     warning: {w}")
        for m in p["mismatches"]:
            print(f"     MISMATCH {m}")
        if not p["originals_unchanged"]:
            print("     AN ORIGINAL FILE CHANGED")
        if p["error"]:
            print(f"     error: {p['error']}")
    for key, value in (report.get("stores") or {}).items():
        print(f"store {key}: {json.dumps(value)}")
    print("PASS" if report["ok"] else "FAIL")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recent", action="store_true", help="every folder in the app's recent list")
    parser.add_argument("--folders", nargs="*", default=[], help="more project folders")
    parser.add_argument("--data-dir", type=Path, default=None, help="the app-data folder to copy stores from")
    parser.add_argument("--out", type=Path, default=None, help="write the JSON report here")
    parser.add_argument("--work-dir", type=Path, default=None, help="where the copies go (default: a temp dir)")
    parser.add_argument("--keep", action="store_true", help="keep the copies after the run")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    data_dir = args.data_dir or default_data_dir()
    folders = (recent_folders(data_dir) if args.recent else []) + [Path(f) for f in args.folders]
    work = args.work_dir or Path(tempfile.mkdtemp(prefix="kestrel-dry-run-"))
    try:
        report = dry_run(folders, data_dir, work)
    finally:
        if not args.keep and args.work_dir is None:
            shutil.rmtree(work, ignore_errors=True)
    print_report(report)
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2, default=str), "utf-8")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_dry_run.py tests/test_migration_real.py -v`
Expected: 5 passed, 1 skipped (`KESTREL_REAL_PROJECTS is not set`).

- [ ] **Step 7: Lint**

Run: `& $PY -m ruff check app/migration scripts/migration_dry_run.py tests/test_migration_*.py tests/migration_helpers.py; & $PY -m ruff format --check app/migration scripts tests`
Expected: `All checks passed!` and no files to reformat. If the formatter reports files, run it without `--check` and include the changes in this commit.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/migration/invariants.py backend/scripts/migration_dry_run.py backend/pyproject.toml backend/tests/test_migration_dry_run.py backend/tests/test_migration_real.py
git commit -m "feat(migration): dry-run script over copies of project folders" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Registry hooks and the `project_migrate` job

**Files:**
- Modify: `backend/app/projects/service.py` (`ProjectHandle.__init__`, `ProjectRegistry.open`, `_cache`; add `_backup_failed`)
- Create: `backend/app/migration/job.py`
- Test: `backend/tests/test_migration_job.py`

**Interfaces:**
- Consumes:
  - BK's merged registry: `open(folder, remember)`, `_cache(pid, folder, engine, name, remember)`, `_name(h)`
  - `app.state.jobs.projects` (kept by BK)
  - `MigrationStates`, `failed_error` (Task 2); `run_pipeline`, `MigrationEnv`, `StepFailed`, `TARGET_SCHEMA_VERSION` (Task 3); `BackupFailed`, `latest_backup` (Task 1)
- Produces:
  - `ProjectHandle(id, folder, engine, schema_version: int = 1)`, with `.schema_version` cached
  - `ProjectRegistry.open` raises `AppError("project_upgrade_failed", …, 409)` after flagging `backup_failed`
  - `app.migration.job`:
    - `JOB_TYPE = "project_migrate"`, `WAITING_FOR_LIBRARY`
    - `armed() -> bool`
    - `states_for(registry) -> MigrationStates`
    - `blocked_reason(runner) -> str | None`
    - `live_job_id(runner, entry) -> str | None`
    - `publish(runner, folder, entry) -> None` (`migration.changed`)
    - `submit(runner, registry, folder: Path, project_id: str | None = None) -> Job | None`
    - the registered job function `migrate_project(ctx) -> dict`
  - The job result: `{project_id, steps_run, warnings, report_path}`.

- [ ] **Step 1: Rebase onto `main` with BK merged**

```powershell
git log --oneline main -20
git fetch . main:main 2>$null; git rebase main
Select-String -Path backend\app\projects\service.py -Pattern "def _cache|def _name|kind"
```
Expected: BK's merge commit is in the log. `_cache(self, pid: str, folder: Path, engine, name: str, remember: bool)` and `_name` are printed, and no `kind` is. If BK has not merged, stop here and do Task 8 Step 1 (the ADR) meanwhile: Tasks 5–7 edit BK's files.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_migration_job.py`:

```python
"""The `project_migrate` job and the registry's copy-first hooks (foundation spec §11.2, §11.3)."""

from pathlib import Path

import pytest
from migration_helpers import (
    HeldStep,
    arm,
    at_revision,
    legacy_at_head,
    revision_of,
    sha256,
    wait_library_job,
)
from sqlalchemy import text

from app.errors import AppError
from app.migration import backup
from app.migration import job as migration_job
from app.migration.pipeline import Step
from app.migration.state import MigrationStates


def _rename(ctx):
    ctx.session.execute(text("UPDATE project SET name = name || ' (upgraded)'"))
    return {"renamed": 1}


def _states(app) -> MigrationStates:
    return MigrationStates(app.state.settings.data_dir)


def _submit(app, folder):
    return migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")


def test_the_job_runs_the_steps_and_records_ok(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("rename", "Renaming", _rename))
    folder = legacy_at_head(tmp_path / "legacy")
    job = _submit(app, folder)
    done = wait_library_job(client, job.id)
    assert done["state"] == "succeeded", done
    entry = _states(app).get(folder)
    assert (entry["state"], entry["job_id"], entry["project_id"]) == ("ok", job.id, "p-legacy")
    assert entry["report_path"].endswith("migration-v2.json")
    handle = app.state.projects.open(folder, remember=False)
    assert handle.schema_version == 2
    with handle.session() as s:
        assert handle.row(s).name == "Legacy (upgraded)"


def test_disarmed_the_job_only_opens_the_project(app, client, tmp_path, monkeypatch):
    arm(monkeypatch)
    folder = legacy_at_head(tmp_path / "legacy")
    assert wait_library_job(client, _submit(app, folder).id)["state"] == "succeeded"
    assert _states(app).get(folder)["state"] == "ok"
    assert app.state.projects.open(folder, remember=False).schema_version == 1


def test_one_live_job_per_folder_however_it_is_spelled(app, client, tmp_path, monkeypatch):
    held = HeldStep()
    arm(monkeypatch, held.step())
    folder = legacy_at_head(tmp_path / "Legacy")
    try:
        first = _submit(app, folder)
        assert held.entered.wait(10)
        assert _submit(app, Path(str(folder).upper())) is None
    finally:
        held.release.set()
    assert wait_library_job(client, first.id)["state"] == "succeeded"


def test_a_failed_step_flags_the_project_and_a_new_job_resumes(app, client, tmp_path, monkeypatch):
    ran = []

    def first(ctx):
        ran.append("first")
        return {}

    def broken(ctx):
        raise RuntimeError("the disk is full")

    arm(monkeypatch, Step("first", "First", first), Step("second", "Second", broken))
    folder = legacy_at_head(tmp_path / "legacy")
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "failed" and "second" in done["error"] and "the disk is full" in done["error"]
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"], entry["step"]) == ("failed", "step_failed", "second")
    arm(monkeypatch, Step("first", "First", first), Step("second", "Second", lambda ctx: {}))
    assert wait_library_job(client, _submit(app, folder).id)["state"] == "succeeded"
    assert ran == ["first"]  # the recorded step did not run again
    assert _states(app).get(folder)["state"] == "ok"


def test_a_failed_backup_flags_backup_failed_and_touches_nothing(app, client, tmp_path, monkeypatch):
    arm(monkeypatch)
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("in the way", "utf-8")
    before = sha256(folder / "project.db")
    done = wait_library_job(client, _submit(app, folder).id)
    assert done["state"] == "failed" and "backed up" in done["error"]
    entry = _states(app).get(folder)
    assert (entry["state"], entry["code"]) == ("failed", "backup_failed")
    assert sha256(folder / "project.db") == before and revision_of(folder / "project.db") == "0008"


def test_opening_a_project_whose_backup_fails_is_409_upgrade_failed(app, client, tmp_path, monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    folder = at_revision(tmp_path / "old", "0008")
    (folder / "backups").write_text("in the way", "utf-8")
    with pytest.raises(AppError) as err:
        app.state.projects.open(folder, remember=False)
    assert (err.value.code, err.value.status) == ("project_upgrade_failed", 409)
    assert err.value.details["backup_path"] is None and "backed up" in err.value.details["error"]


def test_without_the_library_nothing_is_submitted(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("rename", "Renaming", _rename))
    monkeypatch.setattr(app.state.jobs, "library", None)
    folder = legacy_at_head(tmp_path / "legacy")
    assert _submit(app, folder) is None
    assert _states(app).get(folder) is None
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_job.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.migration.job'`.

- [ ] **Step 4: Change the registry**

In `backend/app/projects/service.py`:

1. Add to the imports:
   ```python
   from app.migration.backup import BackupFailed
   from app.migration.state import MigrationStates, failed_error
   ```
2. `ProjectHandle.__init__` becomes:
   ```python
       def __init__(self, id: str, folder: Path, engine, schema_version: int = 1):
           self.id, self.folder, self.engine = id, folder, engine
           # The project's `schema_version`, cached: the migration gate reads it on every request
           # (foundation spec §11.3), and the `project_migrate` job sets it when the upgrade finishes.
           self.schema_version = schema_version
           self._factory = make_session_factory(engine)
   ```
3. In `ProjectRegistry.open`, replace the lines from `engine = open_project_db(folder)` to the `return` with:
   ```python
               try:
                   engine = open_project_db(folder)
               except BackupFailed as e:
                   raise self._backup_failed(folder, e) from e
               with make_session_factory(engine)() as s:
                   row = s.execute(select(Project)).scalar_one()
                   pid, name, version = row.id, row.name, row.schema_version
               return self._cache(pid, folder, engine, name, remember, schema_version=version)
   ```
4. `_cache` gains the keyword, and the handle is built with it **before** `on_open` runs:
   ```python
       def _cache(
           self, pid: str, folder: Path, engine, name: str, remember: bool, schema_version: int = 1
       ) -> ProjectHandle:
           h = ProjectHandle(pid, folder, engine, schema_version)
   ```
   The rest of `_cache` is unchanged. Keep `create` as BK left it: `_cache(pid, folder, engine, name, remember=True)`. Part B sets its version (Task 15).
5. Add to `ProjectRegistry`:
   ```python
       def _backup_failed(self, folder: Path, error: BackupFailed) -> AppError:
           """Flag `failed/backup_failed` (foundation spec §11.2): the database was not touched."""
           entry = MigrationStates(self.appdata.data_dir).set(
               folder, state="failed", code=BackupFailed.code, step=None, error=str(error),
               job_id=None, backup_path=None,
           )
           log.error("project at %s was not upgraded: %s", folder, error)
           return failed_error(entry)
   ```

- [ ] **Step 5: Write `app/migration/job.py`**

```python
"""The `project_migrate` job (foundation spec §11.3, F8): one per project, in the library runner.

The job opens the project through the registry, which takes the copy-first backup and upgrades the
schema, then runs the data steps (`app.migration.steps.PIPELINE`) and records the outcome in
`migrations.json`. It is resumable: the step ledger lets a new job start where a failed or
cancelled one stopped. While `PIPELINE` is empty the orchestration is disarmed (`armed()`), and
the job only opens the project.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.library.handle import LIBRARY_UNAVAILABLE
from app.migration import steps
from app.migration.backup import latest_backup
from app.migration.pipeline import TARGET_SCHEMA_VERSION, MigrationEnv, StepFailed, run_pipeline
from app.migration.state import MigrationStates

JOB_TYPE = "project_migrate"
WAITING_FOR_LIBRARY = "Waiting for the model library: this project opens once the library is available."
CANCELLED = "The upgrade was cancelled. Retry to finish it."
log = logging.getLogger(__name__)


def armed() -> bool:
    return bool(steps.PIPELINE)


def states_for(registry) -> MigrationStates:
    return MigrationStates(registry.appdata.data_dir)


def blocked_reason(runner) -> str | None:
    """Why no upgrade job can run right now, or None (foundation spec §15)."""
    if getattr(runner, "library", None) is None:
        return WAITING_FOR_LIBRARY
    return None


def live_job_id(runner, entry: dict | None) -> str | None:
    job_id = (entry or {}).get("job_id")
    return job_id if job_id and runner.is_live(job_id) else None


def publish(runner, folder, entry: dict) -> None:
    runner.events.publish(
        {
            "type": "migration.changed",
            "project_id": entry.get("project_id") or "library",
            "job_id": entry.get("job_id"),
            "progress": None,
            "message": "",
            "payload": {"folder": str(folder), "state": entry.get("state"), "code": entry.get("code")},
        }
    )


def submit(runner, registry, folder: Path, project_id: str | None = None):
    """Queue one `project_migrate` job for `folder`; None when one is live or none can run."""
    if blocked_reason(runner) is not None:
        return None
    states = states_for(registry)
    with states.locked():
        if live_job_id(runner, states.get(folder)):
            return None
        job = runner.submit(runner.library, JOB_TYPE, {"folder": str(folder), "project_id": project_id})
        entry = states.set(
            folder, state="pending", job_id=job.id, project_id=project_id, code=None, step=None, error=None
        )
    publish(runner, folder, entry)
    return job


def _backup(folder: Path) -> str | None:
    found = latest_backup(folder)
    return str(found) if found else None


def _fail(runner, states: MigrationStates, folder: Path, **fields) -> None:
    publish(runner, folder, states.set(folder, state="failed", **fields))


@register_job_type(JOB_TYPE)
def migrate_project(ctx) -> dict:
    runner = ctx.runner
    if getattr(runner, "library", None) is None:
        raise JobFailure(LIBRARY_UNAVAILABLE)
    registry = runner.projects
    folder = Path(ctx.params["folder"])
    states = states_for(registry)
    ctx.progress(0, "Backing up and opening the project")
    try:
        handle = registry.open(folder, remember=False)
    except AppError as e:
        if e.code != "project_upgrade_failed":  # a failed backup is flagged by the registry itself
            _fail(runner, states, folder, code="open_failed", step=None, error=e.message)
        raise JobFailure(e.message) from e
    except Exception as e:
        message = f"{type(e).__name__}: {e}"
        _fail(runner, states, folder, code="open_failed", step=None, error=message)
        raise JobFailure(f"The project could not be opened: {message}") from e
    report: dict = {"steps": [], "warnings": [], "report_path": None}
    if armed() and handle.schema_version < TARGET_SCHEMA_VERSION:
        env = MigrationEnv(
            library=runner.library,
            catalogue=getattr(runner, "catalogue", None),
            origin_folder=handle.folder,
            log=ctx.log,
            progress=ctx.progress,
            check_cancelled=ctx.check_cancelled,
        )
        try:
            report = run_pipeline(handle, env, steps.PIPELINE)
        except JobCancelled:
            _fail(runner, states, folder, code="cancelled", step=None, error=CANCELLED)
            raise
        except StepFailed as e:
            _fail(runner, states, folder, code="step_failed", step=e.step, error=e.message,
                  backup_path=_backup(handle.folder))
            raise JobFailure(f"The upgrade stopped at step {e.step}: {e.message}") from e
        handle.schema_version = TARGET_SCHEMA_VERSION
    entry = states.set(
        folder, state="ok", code=None, step=None, error=None, project_id=handle.id,
        backup_path=_backup(handle.folder), report_path=report.get("report_path"),
    )
    publish(runner, folder, entry)
    return {
        "project_id": handle.id,
        "steps_run": sum(1 for s in report["steps"] if not s.get("skipped")),
        "warnings": len(report["warnings"]),
        "report_path": report.get("report_path"),
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_job.py tests/test_projects.py tests/test_library_jobs.py -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/projects/service.py backend/app/migration/job.py backend/tests/test_migration_job.py
git commit -m "feat(migration): the project_migrate library job, and backup failures flag the project" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The gate on `get_project`, submit on open, submit at startup

**Files:**
- Create: `backend/app/migration/gate.py`, `backend/app/migration/startup.py`
- Modify: `backend/app/projects/service.py` (`get_project`), `backend/app/main.py` (`project_opened`, `lifespan`)
- Test: `backend/tests/test_migration_gate.py`

**Interfaces:**
- Consumes: Task 5's `job` module and `ProjectHandle.schema_version`; Task 2's `failed_error`, `upgrading_error`.
- Produces:
  - `gate`:
    - `migration_state(handle, runner) -> dict`, with keys `state`, `job_id`, `error`, `code`, `step`, `backup_path`, `report_path`
    - `ensure_submitted(handle, runner) -> Job | None`
    - `require_ready(handle, runner) -> None`, which raises the two 409s
  - `startup`:
    - `probe_schema_version(folder: Path) -> int | None`
    - `submit_pending(app) -> list[str]` (the submitted job ids)
  - `get_project` raises 409 `project_upgrading` (`{job_id}`) or 409 `project_upgrade_failed` (`{error, backup_path}`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_gate.py`:

```python
"""No project route runs on half-migrated data (foundation spec §11.3, §15)."""

import pytest
from fastapi.testclient import TestClient
from migration_helpers import (
    AUTH,
    HeldStep,
    add_ledger_table,
    arm,
    legacy_at_head,
    set_schema_version,
    wait_library_job,
)

from app.appdata import AppData
from app.migration.pipeline import Step
from app.migration.state import MigrationStates


def _noop(ctx):
    return {}


def _boom(ctx):
    raise RuntimeError("boom")


def _make_legacy(handle):
    set_schema_version(handle.folder, 1)
    add_ledger_table(handle.folder)
    handle.schema_version = 1


@pytest.fixture
def held(client, monkeypatch):
    h = HeldStep()
    arm(monkeypatch, h.step())
    yield h
    h.release.set()


def test_disarmed_a_version_1_project_opens(client, project_id, handle, monkeypatch):
    arm(monkeypatch)
    _make_legacy(handle)
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_an_upgrading_project_answers_409_until_the_job_finishes(client, project_id, handle, held):
    _make_legacy(handle)
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrading"
    job_id = r.json()["error"]["details"]["job_id"]
    assert job_id and held.entered.wait(10)
    again = client.get(f"/api/v1/projects/{project_id}/stats")
    assert again.status_code == 409 and again.json()["error"]["details"]["job_id"] == job_id
    held.release.set()
    assert wait_library_job(client, job_id)["state"] == "succeeded"
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_a_failed_upgrade_answers_409_with_the_error_and_is_not_rerun(app, client, project_id, handle, monkeypatch):
    _make_legacy(handle)
    arm(monkeypatch, Step("boom", "Boom", _boom))
    job_id = client.get(f"/api/v1/projects/{project_id}").json()["error"]["details"]["job_id"]
    assert wait_library_job(client, job_id)["state"] == "failed"
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrade_failed"
    details = r.json()["error"]["details"]
    assert "boom" in details["error"] and "backup_path" in details
    assert MigrationStates(app.state.settings.data_dir).get(handle.folder)["job_id"] == job_id


def test_without_the_library_the_project_waits(app, client, project_id, handle, monkeypatch):
    _make_legacy(handle)
    arm(monkeypatch, Step("noop", "Noop", _noop))
    monkeypatch.setattr(app.state.jobs, "library", None)
    r = client.get(f"/api/v1/projects/{project_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrading"
    assert r.json()["error"]["details"] == {"job_id": None}
    assert "model library" in r.json()["error"]["message"]


def test_opening_a_legacy_folder_queues_its_upgrade(app, client, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    assert client.post("/api/v1/projects/open", json={"folder": str(folder)}).status_code == 200
    entry = MigrationStates(app.state.settings.data_dir).get(folder)
    assert entry and entry["job_id"]
    assert wait_library_job(client, entry["job_id"])["state"] == "succeeded"


def test_startup_queues_every_recent_project_below_version_2(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    legacy = legacy_at_head(tmp_path / "legacy")
    current = legacy_at_head(tmp_path / "current", pid="p-current")
    set_schema_version(current, 2)
    recent = AppData(settings.data_dir)
    recent.remember("p-current", "Current", str(current))
    recent.remember("p-legacy", "Legacy", str(legacy))
    with TestClient(app, headers=AUTH) as c:
        states = MigrationStates(settings.data_dir)
        entry = states.get(legacy)
        assert entry and entry["job_id"]
        assert states.get(current) is None
        assert wait_library_job(c, entry["job_id"])["state"] == "succeeded"


def test_an_upgrade_the_last_run_left_unfinished_is_queued_again(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    AppData(settings.data_dir).remember("p-legacy", "Legacy", str(folder))
    MigrationStates(settings.data_dir).set(folder, state="pending", job_id="job-from-the-last-run")
    with TestClient(app, headers=AUTH) as c:
        entry = MigrationStates(settings.data_dir).get(folder)
        assert entry["job_id"] != "job-from-the-last-run"
        assert wait_library_job(c, entry["job_id"])["state"] == "succeeded"


def test_startup_leaves_a_failed_project_for_retry(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    folder = legacy_at_head(tmp_path / "legacy")
    AppData(settings.data_dir).remember("p-legacy", "Legacy", str(folder))
    MigrationStates(settings.data_dir).set(folder, state="failed", code="step_failed", error="x", job_id=None)
    with TestClient(app, headers=AUTH):
        assert MigrationStates(settings.data_dir).get(folder)["job_id"] is None


def test_a_broken_recent_entry_never_stops_startup(app, settings, tmp_path, monkeypatch):
    arm(monkeypatch, Step("noop", "Noop", _noop))
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 64)
    AppData(settings.data_dir).remember("p-broken", "Broken", str(broken))
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_gate.py -v`
Expected: FAIL. `test_an_upgrading_project_answers_409…` gets `200` (`assert 200 == 409`), and the startup tests fail with `assert None` (no entry).

- [ ] **Step 3: Write `app/migration/gate.py`**

```python
"""What a request may do with a project below the foundation schema (foundation spec §11.3, §15).

Disarmed (no steps) or at schema version 2, a project is `ok`. Otherwise it is `failed` (as
`migrations.json` records), `running` (its job is live in this process), or `pending` (no job can
run yet: the reason is in `error`).
"""

from app.errors import AppError
from app.migration.backup import latest_backup
from app.migration.job import armed, blocked_reason, live_job_id, states_for, submit
from app.migration.pipeline import TARGET_SCHEMA_VERSION
from app.migration.state import failed_error, upgrading_error


def _base(entry: dict) -> dict:
    return {"job_id": None, "error": None, "code": None, "step": None,
            "backup_path": entry.get("backup_path"), "report_path": entry.get("report_path")}


def migration_state(handle, runner) -> dict:
    entry = states_for(runner.projects).get(handle.folder) or {}
    if not armed() or handle.schema_version >= TARGET_SCHEMA_VERSION:
        return {**_base(entry), "state": "ok"}
    if entry.get("state") == "failed":
        return {**_base(entry), "state": "failed", "error": entry.get("error"), "code": entry.get("code"),
                "step": entry.get("step")}
    job_id = live_job_id(runner, entry)
    return {**_base(entry), "state": "running" if job_id else "pending", "job_id": job_id,
            "error": None if job_id else blocked_reason(runner)}


def ensure_submitted(handle, runner):
    """On open: queue the upgrade of a project below the target schema, unless one is live or it
    failed. A failed upgrade waits for the operator's Retry; it is not re-run on every open."""
    if not armed() or handle.schema_version >= TARGET_SCHEMA_VERSION:
        return None
    entry = states_for(runner.projects).get(handle.folder) or {}
    if entry.get("state") == "failed":
        return None
    return submit(runner, runner.projects, handle.folder, handle.id)


def require_ready(handle, runner) -> None:
    """Raise 409 `project_upgrading` or `project_upgrade_failed` unless the project is `ok`."""
    state = migration_state(handle, runner)
    if state["state"] == "ok":
        return
    if state["state"] == "failed":
        raise failed_error(state)
    if state["job_id"] is None:
        job = ensure_submitted(handle, runner)
        if job is not None:
            raise upgrading_error(job.id)
    raise upgrading_error(state["job_id"], state["error"])


def unavailable_state(registry, folder, error: Exception) -> dict:
    """The state of a recent project that could not be opened at all (foundation spec §9.2)."""
    entry = states_for(registry).get(folder) or {}
    if entry.get("state") == "failed":
        return {**_base(entry), "state": "failed", "error": entry.get("error"), "code": entry.get("code"),
                "step": entry.get("step")}
    message = error.message if isinstance(error, AppError) else f"{type(error).__name__}: {error}"
    found = latest_backup(folder)
    return {**_base(entry), "state": "failed", "error": message, "code": "open_failed",
            "backup_path": str(found) if found else None}
```

- [ ] **Step 4: Write `app/migration/startup.py`**

```python
"""Queue the upgrade of every recent project still below the foundation schema, at startup
(foundation spec §11.3). Nothing here opens a project: the schema version is read with one
read-only query per folder, and the job does the backup and the upgrade in the background. A
failure is logged per folder, and startup carries on (AGENTS.md).
"""

import logging
import sqlite3
from pathlib import Path

from app.migration.job import armed, blocked_reason, states_for, submit
from app.migration.pipeline import TARGET_SCHEMA_VERSION

log = logging.getLogger(__name__)


def probe_schema_version(folder: Path) -> int | None:
    """`project.schema_version`, read-only; None when the folder has no project database."""
    db = Path(folder) / "project.db"
    if not db.is_file():
        return None
    con = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = con.execute("SELECT schema_version FROM project LIMIT 1").fetchone()
    finally:
        con.close()
    return int(row[0]) if row else None


def submit_pending(app) -> list[str]:
    if not armed():
        return []
    runner, registry = app.state.jobs, app.state.projects
    reason = blocked_reason(runner)
    if reason is not None:
        log.warning("project upgrades are waiting: %s", reason)
        return []
    states = states_for(registry)
    submitted = []
    for r in registry.recent():
        folder = Path(r["folder"])
        try:
            if (states.get(folder) or {}).get("state") == "failed":
                continue  # Retry is the operator's call
            try:
                version = probe_schema_version(folder)
            except sqlite3.Error as e:
                log.warning("could not read the schema version of %s (%s); the job will open it", folder, e)
                version = 0
            if version is None or version >= TARGET_SCHEMA_VERSION:
                continue
            job = submit(runner, registry, folder, r.get("id"))
            if job is not None:
                submitted.append(job.id)
        except Exception:
            log.exception("could not queue the upgrade of %s", folder)
    return submitted
```

The broken-recent-entry test makes the probe raise `sqlite3.DatabaseError`. The job then opens the folder, fails, and flags it `open_failed`, which is the correct outcome.

- [ ] **Step 5: Gate `get_project`**

In `backend/app/projects/service.py`, replace `get_project` with:

```python
def get_project(projectId: str, request: Request) -> ProjectHandle:  # noqa: N803 - path param from the contract
    handle = request.app.state.projects.get(projectId)
    # Imported here: the migration job module imports the job runner, which imports this module.
    from app.migration.gate import require_ready

    require_ready(handle, request.app.state.jobs)
    return handle
```

- [ ] **Step 6: Wire `main.py`**

1. In `project_opened`, add to the local imports `from app.migration import gate as migration_gate`. Make this the **first** entry of the step tuple:
   ```python
           # A project below the foundation schema queues its upgrade (foundation spec §11.3).
           ("project upgrade", lambda: migration_gate.ensure_submitted(handle, runner)),
   ```
2. In `lifespan`, directly after the `if app.state.library is not None:` block that runs `sweep_orphans` on the library (so a job row a crash left `running` is closed first), add:
   ```python
           # Upgrade recent projects that predate the foundation schema in the background (spec §11.3).
           # After the library (and, once unit BC has landed, the catalogue) opened.
           try:
               from app.migration import startup as migration_startup

               migration_startup.submit_pending(app)
           except Exception:
               logging.getLogger(__name__).exception("queuing project upgrades failed")
   ```
3. Confirm that `app.state.jobs.projects = app.state.projects` is still in `lifespan` (BK keeps it). The job reads the registry from there.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_gate.py tests/test_migration_job.py tests/test_projects.py tests/test_job_startup.py -v`
Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/migration/gate.py backend/app/migration/startup.py backend/app/projects/service.py backend/app/main.py backend/tests/test_migration_gate.py
git commit -m "feat(migration): projects below schema 2 answer 409 while they upgrade; startup queues them" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `GET /projects` isolation, `Project.migration`, and Retry

**Files:**
- Modify: `backend/app/projects/schemas.py`, `backend/app/projects/router.py` (`_out`, `list_projects`, `create_project`, `open_project`), `backend/app/api.py`
- Modify (missing folders, operator decision 2026-09-26): `backend/app/projects/service.py` (`ProjectRegistry.forget` drops a missing entry without opening it), `backend/app/appdata.py` (`remember` replaces an entry with the same project id), `backend/tests/test_projects.py` (`test_recent_skips_deleted_folders` becomes `test_recent_lists_deleted_folders_as_missing`)
- Create: `backend/app/migration/router.py`
- Modify (only if Task 0 found them): C0's 501 stub entry for the retry operation, and its `EXPECTED_STUBS` entry in `backend/tests/test_contract.py`
- Test: `backend/tests/test_migration_projects_api.py`

**Interfaces:**
- Consumes: `gate.migration_state`, `gate.unavailable_state` (Task 6); `job.submit`, `live_job_id`, `states_for` (Task 5); `app.library.handle.library_unavailable`.
- Produces:
  - `MigrationStateOut` (pydantic, `state` required with default `"ok"`, the other six keys optional)
  - `ProjectOut.migration: MigrationStateOut`
  - `ProjectOut.availability: Literal["ok", "missing"] = "ok"` (C0's `ProjectAvailability`)
  - `ProjectOut.unavailable(recent: dict, migration: MigrationStateOut, availability: str = "ok") -> ProjectOut`
  - `POST /api/v1/projects/migrations/retry {folder}` → 202 `MigrationState`, 404, 409 `project_upgrading`, 503 `library_unavailable`
  - `POST /api/v1/projects/migrations/reveal-backup {folder}` → 204 (C0's `revealProjectBackup`, requested by S1): shows the backup recorded in `migrations.json` in Explorer through `app.exports.reveal.launch`; 404 when none is recorded or its file is gone

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_projects_api.py`:

```python
"""GET /projects never fails for one project; Retry (foundation spec §9.2, §11.3, §15)."""

import pytest
from migration_helpers import (
    HeldStep,
    arm,
    at_revision,
    legacy_at_head,
    revision_of,
    sha256,
    wait_library_job,
)

from app.migration import backup
from app.migration import job as migration_job
from app.migration.backup import latest_backup

RETRY = "/api/v1/projects/migrations/retry"


@pytest.fixture
def held(client, monkeypatch):
    h = HeldStep()
    arm(monkeypatch, h.step())
    yield h
    h.release.set()


@pytest.fixture
def blocked_old(app, tmp_path, monkeypatch):
    """A 0008 project whose backup cannot be written (a file named `backups`), in the recent list."""
    arm(monkeypatch)
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    old = at_revision(tmp_path / "old", "0008", pid="p-old", name="Old")
    (old / "backups").write_text("in the way", "utf-8")
    app.state.projects.appdata.remember("p-old", "Old", str(old))
    return old


def _items(client) -> dict:
    r = client.get("/api/v1/projects")
    assert r.status_code == 200, r.text
    return {p["id"]: p for p in r.json()["items"]}


def test_one_failing_project_never_fails_the_list(client, project_id, blocked_old):
    before = sha256(blocked_old / "project.db")
    items = _items(client)
    assert items[project_id]["migration"]["state"] == "ok"
    old = items["p-old"]
    assert (old["name"], old["folder"]) == ("Old", str(blocked_old))
    assert old["migration"]["state"] == "failed" and old["migration"]["code"] == "backup_failed"
    assert "backed up" in old["migration"]["error"]
    assert sha256(blocked_old / "project.db") == before


def test_an_unreadable_database_is_listed_as_failed(app, client, project_id, tmp_path):
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 64)
    app.state.projects.appdata.remember("p-broken", "Broken", str(broken))
    item = _items(client)["p-broken"]
    assert item["migration"]["state"] == "failed" and item["migration"]["code"] == "open_failed"
    assert item["migration"]["error"]


def test_a_deleted_folder_is_listed_as_missing_and_can_be_removed(app, client, project_id, tmp_path):
    gone = tmp_path / "gone"
    app.state.projects.appdata.remember("p-gone", "Gone", str(gone))  # never existed on disk
    item = _items(client)["p-gone"]
    assert item["availability"] == "missing" and item["migration"]["state"] == "ok"
    assert (item["name"], item["folder"], item["summary"]) == ("Gone", str(gone), None)
    assert _items(client)[project_id]["availability"] == "ok"
    assert client.delete("/api/v1/projects/p-gone").status_code == 204
    assert "p-gone" not in _items(client)


def test_locating_a_moved_folder_replaces_the_missing_entry(app, client, tmp_path):
    import shutil

    folder = tmp_path / "old-place"
    r = client.post("/api/v1/projects", json={"name": "Moved", "folder": str(folder), "type_ids": []})
    pid = r.json()["id"]
    app.state.projects.close_all()  # release the SQLite handles before moving the folder
    moved = tmp_path / "new-place"
    shutil.move(str(folder), str(moved))
    assert _items(client)[pid]["availability"] == "missing"
    assert client.post("/api/v1/projects/open", json={"folder": str(moved)}).status_code == 200
    items = [p for p in client.get("/api/v1/projects").json()["items"] if p["id"] == pid]
    assert [(p["folder"], p["availability"]) for p in items] == [(str(moved), "ok")]


def test_a_live_upgrade_is_listed_as_running(app, client, tmp_path, held):
    folder = legacy_at_head(tmp_path / "legacy")
    app.state.projects.appdata.remember("p-legacy", "Legacy", str(folder))
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")
    assert held.entered.wait(10)
    item = _items(client)["p-legacy"]
    assert item["migration"]["state"] == "running" and item["migration"]["job_id"] == job.id


def test_retry_upgrades_a_project_whose_backup_failed(client, blocked_old):
    assert _items(client)["p-old"]["migration"]["state"] == "failed"
    (blocked_old / "backups").unlink()
    r = client.post(RETRY, json={"folder": str(blocked_old)})
    assert r.status_code == 202, r.text
    assert r.json()["state"] == "pending" and r.json()["job_id"]
    assert wait_library_job(client, r.json()["job_id"])["state"] == "succeeded"
    assert _items(client)["p-old"]["migration"]["state"] == "ok"
    assert revision_of(latest_backup(blocked_old)) == "0008"


def test_retry_while_an_upgrade_runs_is_409(app, client, tmp_path, held):
    folder = legacy_at_head(tmp_path / "legacy")
    job = migration_job.submit(app.state.jobs, app.state.projects, folder, "p-legacy")
    assert held.entered.wait(10)
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_upgrading"
    assert r.json()["error"]["details"] == {"job_id": job.id}


def test_reveal_backup_shows_the_recorded_copy_in_explorer(client, blocked_old, monkeypatch):
    from app.exports import reveal

    launched: list[str] = []
    monkeypatch.setattr(reveal, "launch", launched.append)
    assert client.post("/api/v1/projects/migrations/reveal-backup", json={"folder": str(blocked_old)}).status_code == 404
    (blocked_old / "backups").unlink()
    r = client.post(RETRY, json={"folder": str(blocked_old)})
    assert wait_library_job(client, r.json()["job_id"])["state"] == "succeeded"
    assert client.post("/api/v1/projects/migrations/reveal-backup", json={"folder": str(blocked_old)}).status_code == 204
    assert len(launched) == 1 and "/select," in launched[0] and str(latest_backup(blocked_old)) in launched[0]


def test_retry_of_a_folder_without_a_project_is_404(client, tmp_path):
    assert client.post(RETRY, json={"folder": str(tmp_path / "nothing")}).status_code == 404


def test_retry_without_the_library_is_503(app, client, tmp_path, monkeypatch):
    folder = legacy_at_head(tmp_path / "legacy")
    monkeypatch.setattr(app.state.jobs, "library", None)
    r = client.post(RETRY, json={"folder": str(folder)})
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_projects_api.py -v`
Expected: FAIL. The list tests fail with `KeyError: 'migration'` (or a 500 from the failing open), and the retry tests get `404`/`405`/`501`.

- [ ] **Step 3: The schemas**

In `backend/app/projects/schemas.py`, add `UTC` to the `datetime` import (`from datetime import UTC, datetime`) and add above `ProjectOut`:

```python
MigrationStateName = Literal["ok", "pending", "running", "failed"]


class MigrationStateOut(BaseModel):
    """`MigrationState` (foundation spec §9.2, §11.3): where a project's upgrade stands."""

    state: MigrationStateName = "ok"
    job_id: str | None = None
    error: str | None = None
    code: str | None = None
    step: str | None = None
    backup_path: str | None = None
    report_path: str | None = None
```

In `ProjectOut`, add the fields `migration: MigrationStateOut = Field(default_factory=MigrationStateOut)` and `availability: Literal["ok", "missing"] = "ok"`, and this classmethod:

```python
    @classmethod
    def unavailable(cls, recent: dict, migration: "MigrationStateOut", availability: str = "ok") -> "ProjectOut":
        """A recent project that could not be opened, is upgrading, or whose folder is gone
        (`availability="missing"`): listed with what the recent list knows, so one folder never
        fails the whole list (foundation spec §9.2; operator decision 2026-09-26)."""
        try:
            opened = datetime.fromisoformat(recent["last_opened_at"])
        except (KeyError, TypeError, ValueError):
            opened = datetime(1970, 1, 1, tzinfo=UTC)
        return cls(
            id=recent["id"],
            name=recent["name"],
            folder=recent["folder"],
            classes=[],
            preannotation_model_id=None,
            import_defaults=ImportSettings(),
            schema_version=0,
            created_at=opened,
            migration=migration,
            availability=availability,
        )
```

If `ProjectOut` has other required fields by the time of the rebase (for example `summary` from BC), pass `summary=None` here as well. C0 makes it nullable (see "Names to reconcile").

- [ ] **Step 4: The projects router**

In `backend/app/projects/router.py`:
1. Add the imports:
   ```python
   import logging

   from app.migration.gate import migration_state, unavailable_state
   from app.migration.job import live_job_id, states_for
   from app.projects.schemas import MigrationStateOut
   ```
   Add `log = logging.getLogger(__name__)` after `router = …`.
2. Replace `_out` and `list_projects`:
   ```python
   def _out(handle: ProjectHandle, runner=None) -> ProjectOut:
       with handle.session() as s:
           out = ProjectOut.from_row(handle.row(s), handle.folder)
       if runner is not None:
           out.migration = MigrationStateOut(**migration_state(handle, runner))
       return out


   @router.get("", response_model=ProjectPage)
   def list_projects(request: Request) -> ProjectPage:
       """Every recent project, each on its own: one that fails to open or upgrade is listed as
       `failed`, never failing the list, and one whose upgrade job is live is listed as `running`
       without opening it, so the list never waits on its backup (foundation spec §9.2)."""
       reg, runner = _registry(request), request.app.state.jobs
       states = states_for(reg)
       items: list[ProjectOut] = []
       for r in reg.recent():
           folder = Path(r["folder"])
           if not (folder / "project.db").exists():
               # Listed, not hidden (operator decision 2026-09-26): the card offers Remove and Locate.
               items.append(ProjectOut.unavailable(r, MigrationStateOut(), availability="missing"))
               continue
           live = live_job_id(runner, states.get(folder))
           if live is not None:
               items.append(ProjectOut.unavailable(r, MigrationStateOut(state="running", job_id=live)))
               continue
           try:
               items.append(_out(reg.open(folder, remember=False), runner))
           except Exception as e:
               log.warning("project at %s could not be listed: %s", folder, e)
               items.append(ProjectOut.unavailable(r, MigrationStateOut(**unavailable_state(reg, folder, e))))
       return ProjectPage(items=items, next_cursor=None)
   ```
3. `create_project` and `open_project` return `_out(<handle>, request.app.state.jobs)`, so the new card or the opened project shows its migration state. `open_project` needs `request` (it already has it). The other routes keep `_out(handle)`: they are gated, so their project is `ok`.
4. Missing folders (operator decision 2026-09-26):
   - `backend/app/projects/service.py`, `ProjectRegistry.forget(project_id)`: before `h = self.get(project_id)`, look the id up in `self.appdata.recent()`; when its folder has no `project.db`, call `self.appdata.forget(entry["folder"])` and return (nothing to close, no jobs can run).
   - `backend/app/appdata.py`, `AppData.remember(project_id, name, folder, …)`: the filter that drops the old entry becomes `r["folder"].lower() != folder.lower() and r["id"] != project_id`, so opening a project from its new folder (Locate folder…) replaces the stale entry of the same id.
   - `backend/tests/test_projects.py`: rename `test_recent_skips_deleted_folders` to `test_recent_lists_deleted_folders_as_missing` and change its assertion to
     `assert [(p["name"], p["availability"]) for p in r.json()["items"]] == [("A", "ok"), ("Gone", "missing")]`.
     This deliberately reverses today's tested behaviour (the operator's decision).

- [ ] **Step 5: The retry router**

Create `backend/app/migration/router.py`:

```python
"""`POST /projects/migrations/retry` (foundation spec §11.3): upgrade a project again, after the
operator fixed what stopped it. The job reopens the folder, so a failed backup is retried too, and
the step ledger resumes the data steps from the first one not done. Restoring a backup stays a
manual act ("Reveal backup"); nothing here overwrites a database.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator

from app.errors import not_found
from app.library.handle import library_unavailable
from app.migration.job import live_job_id, states_for, submit
from app.migration.state import upgrading_error
from app.projects.schemas import MigrationStateOut

router = APIRouter(prefix="/projects/migrations", tags=["projects"])


class MigrationRetry(BaseModel):
    folder: str

    @field_validator("folder")
    @classmethod
    def _absolute(cls, v: str) -> str:
        if not Path(v).is_absolute():
            raise ValueError("folder must be an absolute path")
        return v


def _recent_id(registry, folder: Path) -> str | None:
    key = str(folder).lower()
    return next((r["id"] for r in registry.recent() if str(Path(r["folder"]).resolve()).lower() == key), None)


@router.post("/retry", response_model=MigrationStateOut, status_code=202)
def retry_migration(body: MigrationRetry, request: Request) -> MigrationStateOut:
    registry, runner = request.app.state.projects, request.app.state.jobs
    folder = Path(body.folder).resolve()
    if not (folder / "project.db").is_file():
        raise not_found("project folder", str(folder))
    if getattr(runner, "library", None) is None:
        raise library_unavailable()
    states = states_for(registry)
    with states.locked():
        entry = states.get(folder) or {}
        live = live_job_id(runner, entry)
        if live is not None:
            raise upgrading_error(live)
        states.set(folder, state="pending", code=None, step=None, error=None, job_id=None)
    job = submit(runner, registry, folder, entry.get("project_id") or _recent_id(registry, folder))
    return MigrationStateOut(state="pending", job_id=job.id if job else None, backup_path=entry.get("backup_path"))


@router.post("/reveal-backup", status_code=204)
def reveal_backup(body: MigrationRetry, request: Request) -> Response:
    """C0's `revealProjectBackup`: select the recorded pre-upgrade copy in Explorer. The path comes
    from our own `migrations.json`, never from the caller; nothing is restored."""
    from app.exports import reveal

    folder = Path(body.folder).resolve()
    recorded = (states_for(request.app.state.projects).get(folder) or {}).get("backup_path")
    if not recorded or not Path(recorded).is_file():
        raise not_found("backup", str(folder))
    reveal.launch(f'"{reveal.EXPLORER}" /select,"{Path(recorded).resolve()}"')
    return Response(status_code=204)
```

Add `Response` to the `fastapi` import of this module. If Task 0 found a 501 stub for
`revealProjectBackup`, delete it and its `EXPECTED_STUBS` entry with the retry stub.

In `backend/app/api.py`, import `from app.migration.router import router as migration_router` and put `migration_router` in the first `for r in (...)` tuple **before** `projects_router`. This import is also what registers the `project_migrate` job type in the running app. If Task 0 found a 501 stub for this operation, delete it and its `EXPECTED_STUBS` entry now.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_projects_api.py tests/test_projects.py tests/test_appdata.py tests/test_contract.py -v` (skip `test_appdata.py` if it does not exist)
Expected: all pass, including `test_every_spec_path_is_routed`, `test_no_extra_api_routes` and the schemathesis conformance of the retry operation. If `test_responses_conform` rejects a response shape, C0's `MigrationState` differs from `MigrationStateOut`: align the model with C0 (C0 wins), then rerun.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/projects/schemas.py backend/app/projects/router.py backend/app/projects/service.py backend/app/appdata.py backend/app/migration/router.py backend/app/api.py backend/tests/test_migration_projects_api.py backend/tests/test_projects.py
git commit -m "feat(migration): the project list isolates failures and shows upgrade state; Retry" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
If Step 5 removed C0's stub, also stage its module and `backend/tests/test_contract.py` by path.

---

### Task 8: ADR, gate and merge (Part A)

**Files:**
- Create: `vault/decisions/2026-09-26-migration-framework-ships-disarmed.md`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: a green `task/f-mg-framework`, merged into `main` in its slot (right after BK).

- [ ] **Step 1: Write the ADR**

```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, migration]
related: ["[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]", "[[2026-09-23-library-jobs-reuse-the-project-jobrunner]]"]
---

# The migration framework ships disarmed, and its backup lands before revision 0010

## Context

The foundation migration (spec 2026-09-26-foundation §11) is split into a framework (backup,
job, gate, list isolation, dry run) and its data steps, which need the catalogue and the library
datasets of two other units. The framework could merge weeks before the steps.

## Decision

- `app.migration.steps.PIPELINE` is empty until the steps land, and `armed()` is `bool(PIPELINE)`.
  Disarmed, nothing is submitted, no project is gated, and **no project is marked
  `schema_version = 2`**. A framework that ran `finish` on its own would mark every real project
  upgraded with no data migrated, and the steps would then never run on them.
- The copy-first backup in `open_project_db` is live from the framework on. It guards revision
  `0010` by id, so it activates the moment `0010` exists. The framework merges **before** the
  unit that writes `0010` (BC), so no build of `main` ever upgrades a real project without a copy.
- Stored states are `pending`, `ok` and `failed`; `running` is derived from a live job. A failed
  upgrade is never re-run by itself: only Retry submits it again.

## Consequences

- Positive: each part is safe to merge on its own. The real-folder dry run gates only the steps.
- Negative: a test that exercises the job must pin its own pipeline (`migration_helpers.arm`),
  or it depends on whether the steps have landed.
- Trap: `ProjectRegistry.create` must write `schema_version = 2` once the steps arm, or every new
  project gets a pointless upgrade job and answers 409 until it finishes.

## Related

- `backend/app/migration/`, `backend/app/db/session.py`, `backend/scripts/migration_dry_run.py`
```

- [ ] **Step 2: Rebase and run the whole gate**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-mg-framework
git fetch . main:main 2>$null; git rebase main
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected: every step passes. Part A touches no frontend or contract file, so a failure there is pre-existing on `main`: stop and report it.

- [ ] **Step 3: Commit the ADR**

```powershell
git add vault/decisions/2026-09-26-migration-framework-ships-disarmed.md
git commit -m "docs(vault): ADR - the migration framework ships disarmed, backup before 0010" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Merge in the slot**

When the coordinator gives MG-framework its slot (after BK, before BC), run `scripts\finish-task.ps1` from the worktree. It gates, merges `task/f-mg-framework` into `main`, removes the worktree and deletes the branch. Never pass `-SkipGate`.

- [ ] **Step 5: Operator walkthrough (post with the merge)**

MG-framework is not user-observable yet. It is disarmed, and its backup waits for revision `0010`. For the reviewer:
1. `cd backend; & $PY -m pytest tests/test_migration_backup.py -v`: the copy is taken before the guarded revision, passes `quick_check`, and a failed copy leaves `project.db` byte-identical.
2. `& $PY -m pytest tests/test_migration_projects_api.py -v`: a project whose backup fails is listed as `failed`, the others still list, and Retry upgrades it.
3. `& $PY scripts\migration_dry_run.py --recent --folders E:\Projects\Ahmadia`: prints `armed False`, `[ok]` per project and `PASS`, and leaves the originals untouched (the script checks their hashes).

- [ ] **Step 6: Report to the coordinator**

Send:
- the merged commit range
- the C0 names as confirmed in Task 0
- the hand-offs:
  - **BC:** `0010` must create `migration_step (name PK, done_at, detail)`.
  - **BC:** `ProjectRegistry.create` must write `schema_version = 2` once MG-steps arms. Task 15 does it if BC has not.
  - **BC:** wires `runner.catalogue` (BC Task 1 already does; MG-steps only verifies it).
- the resolved ambiguities 1–10

---

# Part B: MG-steps (`task/f-mg-steps`)

## Part B file map

| File | Task | Change |
| --- | --- | --- |
| `backend/app/migration/ports.py` | 9 | **new**: every BC/BM touchpoint, plain SQL on spec tables |
| `backend/app/migration/rekey.py` | 11 | **new**: pure JSON rekeying |
| `backend/app/migration/steps.py` | 10–15 | the seven steps, `STORE_LOCK`, `PIPELINE` (Task 15) |
| `backend/app/migration/job.py` | 15 | `blocked_reason` waits for the catalogue too |
| `backend/app/projects/service.py` | 15 | `create` writes `schema_version = 2` |
| `backend/app/main.py` | 15 | the `submit_pending` block after BC's `open_catalogue` (BC wires `runner.catalogue`) |
| `backend/scripts/migration_dry_run.py` | 15, 16 | `open_stores` opens the catalogue; `project_checks`; `summarise_stores` |
| `backend/tests/migration_helpers.py` | 9 | store helpers |
| `backend/tests/test_migration_ports.py`, `test_migration_step_catalogue.py`, `test_migration_rekey.py`, `test_migration_step_rewrite.py`, `test_migration_step_types.py`, `test_migration_step_datasets.py`, `test_migration_step_findings.py`, `test_migration_end_to_end.py` | 9–15 | **new** |
| `backend/tests/test_migration_real.py`, `test_migration_dry_run.py` | 16 | real run asserts `armed`; store summary test |
| `docs/evidence/foundation-migration/*`, `docs/progress.md` | 16 | the merge-gate evidence |

---

### Task 9: Preflight, rebase, and the ports with their schema guard

**Files:**
- Create: `backend/app/migration/ports.py`, `backend/tests/test_migration_ports.py`
- Modify: `backend/tests/migration_helpers.py` (append the store helpers)

**Interfaces:**
- Consumes: BC's `open_catalogue_db`, `normalise_name`, `counts.recount` and `app.findings.backfill.findings_from_annotations` (Task 14); BC's and BM's tables (see "Names to reconcile").
- Produces (`app.migration.ports`):
  - Column tuples: `CATALOGUE_TYPE`, `CATALOGUE_META`, `PROJECT_TYPE`, `CLASS_ID_MAP`, `FINDING`, `FINDING_COUNT`, `ACTIVITY`, `LIBRARY_MODEL`, `LIBRARY_DATASET`, `DATASET_SOURCE`
  - `NEEDS_CLASSIFICATION`, `class MigrationBlocked(Exception)`
  - `now() -> str`, `require_catalogue(c)`, `require_library(l)`, `normalise_name`, `open_catalogue_db`
  - Catalogue:
    - `find_type(cs, name) -> dict | None`
    - `hotkey_free(cs, hotkey) -> bool`
    - `create_type(cs, *, name, colour, hotkey) -> str`
    - `flag_needs_classification(cs) -> None`
    - `type_rows(cs, ids) -> dict[str, dict]`
  - Project:
    - `insert_project_type(s, *, type_id, position, hotkey_override, snapshot) -> None`
    - `rebuild_counts(s) -> None`
    - (no finding writers: step 6 calls BC's `findings_from_annotations`)
    - `add_activity_once(s, *, kind, subject_id, summary, payload) -> bool`
  - Library:
    - `merge_class_map(ls, model_id, mapping) -> tuple[int, list[tuple[str, str | None, str | None]]] | None`
    - `legacy_dataset_by_path(ls, path) -> str | None`
    - `unique_dataset_name(ls, wanted) -> str`
    - `insert_legacy_dataset(ls, *, name, classes, split_method, split_params, counts, legacy_path, filter) -> str`
    - `insert_dataset_source(ls, *, dataset_id, project_id, project_folder, project_name, image_count) -> None`
  - Test helpers:
    - `Stores`, `open_stores(data_dir) -> Stores`
    - `env_for(stores, origin_folder) -> MigrationEnv`
    - `run_step(handle, env, fn) -> dict`
    - `catalogue_types(stores_or_handle) -> dict[str, dict]` (keyed by name)
    - `class_id_map(handle) -> dict[str, str]`
    - `needs_classification(catalogue) -> bool`
    - `add_library_model(library, model_id, class_map=None) -> None`

- [ ] **Step 1: Confirm BC, BM and MG-framework are on `main`**

```powershell
cd E:\Dev\Yolo\app
git log --oneline main -40
Select-String -Path backend\app\db\migrations\versions\*.py -Pattern 'revision = "0010"'
Select-String -Path backend\app\library\migrations\versions\*.py -Pattern 'revision = "0002"'
Test-Path backend\app\catalogue\service.py, backend\app\findings\counts.py, backend\app\migration\pipeline.py
```
Expected: all three merges in the log, both revisions found, and three `True`s. If not, stop: Part B needs all three.

- [ ] **Step 2: Cut the worktree and baseline**

```powershell
scripts\start-task.ps1 f-mg-steps
cd E:\Dev\Yolo\app\.claude\worktrees\f-mg-steps\backend
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY -m pytest -q -x
```
Expected: `task/f-mg-steps`, and the suite passes.

- [ ] **Step 3: Reconcile the names**

Read BC's and BM's plans and their merged code. For each BC/BM row of "Names to reconcile", find the real name:
```powershell
Select-String -Path app\catalogue\*.py,app\findings\*.py -Pattern "def normalise_name|def open_catalogue|def recount|def .*backfill|findings_from_annotations"
Select-String -Path app\db\migrations\versions\0010*.py,app\catalogue\migrations\versions\*.py,app\library\migrations\versions\0002*.py -Pattern "create_table|sa.Column\("
Select-String -Path app\main.py -Pattern "catalogue"
```
Rewrite this task's `ports.py` imports and SQL column names to what merged. Record each difference in the Task 16 report. Two points were settled by the reconciliation of 2026-09-26; only confirm them:
- **Box → finding backfill.** Step 6 (Task 14) calls BC's `app.findings.backfill.findings_from_annotations(handle, type_ids=None, …)`. MG writes no `create_findings_for_boxes` and no finding `INSERT`. Confirm the signature with the `Select-String` above.
- **`runner.catalogue`.** BC sets `app.state.jobs.catalogue` in `lifespan` (BC Task 1). Confirm it with the `app\main.py` search above; if it is somehow missing, stop and report to the coordinator (it is BC's).

- [ ] **Step 4: Write the failing schema guard**

Create `backend/tests/test_migration_ports.py`:

```python
"""The migration's view of other units' schemas (foundation spec §7, §8, §12): every column the
steps write must exist in the merged migrations, or this fails naming app/migration/ports.py."""

import pytest
from migration_helpers import at_revision, open_handle, open_stores
from sqlalchemy import text

from app.migration import ports

PROJECT_TABLES = {
    "class_id_map": ports.CLASS_ID_MAP,
    "project_type": ports.PROJECT_TYPE,
    "finding": ports.FINDING,
    "finding_count": ports.FINDING_COUNT,
    "activity": ports.ACTIVITY,
    "migration_step": ("name", "done_at", "detail"),
}
LIBRARY_TABLES = {
    "library_model": ports.LIBRARY_MODEL,
    "dataset": ports.LIBRARY_DATASET,
    "dataset_source": ports.DATASET_SOURCE,
}
CATALOGUE_TABLES = {"catalogue_type": ports.CATALOGUE_TYPE, "catalogue_meta": ports.CATALOGUE_META}


def _columns(engine, table) -> set[str]:
    with engine.connect() as c:
        return {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}


def _missing(engine, tables) -> dict:
    return {t: sorted(set(cols) - _columns(engine, t)) for t, cols in tables.items() if set(cols) - _columns(engine, t)}


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def test_the_project_tables_have_the_columns_the_steps_write(tmp_path):
    handle = open_handle(at_revision(tmp_path / "p", "head"))
    try:
        assert _missing(handle.engine, PROJECT_TABLES) == {}, "update app/migration/ports.py"
    finally:
        handle.engine.dispose()


def test_the_library_and_catalogue_tables_have_the_columns_the_steps_write(stores):
    assert _missing(stores.library.engine, LIBRARY_TABLES) == {}, "update app/migration/ports.py"
    assert _missing(stores.catalogue.engine, CATALOGUE_TABLES) == {}, "update app/migration/ports.py"


def test_normalise_name_is_the_spec_rule():
    assert ports.normalise_name("dump_truck") == ports.normalise_name("Dump truck")
    assert ports.normalise_name("  DUMP-truck ") == ports.normalise_name("dump  truck")
    assert ports.normalise_name("crane") != ports.normalise_name("crane 2")


def test_a_catalogue_type_round_trips(stores):
    with stores.catalogue.session() as cs:
        type_id = ports.create_type(cs, name="dump_truck", colour="#06b6d4", hotkey="3")
    with stores.catalogue.session() as cs:
        found = ports.find_type(cs, "Dump Truck")
        assert found["id"] == type_id and found["kind"] == "object"
        assert not ports.hotkey_free(cs, "3") and ports.hotkey_free(cs, "4")
        assert ports.type_rows(cs, [type_id])[type_id]["name"] == "dump_truck"


def test_counts_rebuild_and_activity_run_on_an_empty_project(tmp_path):
    handle = open_handle(at_revision(tmp_path / "p", "head"))
    try:
        with handle.session() as s:
            ports.rebuild_counts(s)
            assert ports.add_activity_once(s, kind="job.finished", subject_id="p", summary="Project upgraded",
                                           payload={}) is True
            assert ports.add_activity_once(s, kind="job.finished", subject_id="p", summary="Project upgraded",
                                           payload={}) is False
            assert s.execute(text("SELECT COUNT(*) FROM finding_count")).scalar_one() == 0
    finally:
        handle.engine.dispose()
```

Append to `backend/tests/migration_helpers.py`:

```python
# ---- Part B: the app-wide stores the steps write -------------------------------------------------


class Stores:
    def __init__(self, library, catalogue):
        self.library, self.catalogue = library, catalogue

    def close(self) -> None:
        self.library.engine.dispose()
        self.catalogue.engine.dispose()


def open_stores(data_dir: Path) -> Stores:
    from app.library.handle import open_library
    from app.migration import ports

    return Stores(open_library(data_dir), ports.open_catalogue_db(data_dir))


def env_for(stores: Stores, origin_folder: Path):
    import logging

    from app.migration.pipeline import MigrationEnv

    return MigrationEnv(library=stores.library, catalogue=stores.catalogue, origin_folder=origin_folder,
                        log=logging.getLogger("test.migration"))


def run_step(handle, env, fn) -> dict:
    from app.migration.pipeline import StepContext

    with handle.session() as s:
        return fn(StepContext(handle, s, env)) or {}


def catalogue_types(catalogue) -> dict[str, dict]:
    from sqlalchemy import text

    store = getattr(catalogue, "catalogue", catalogue)
    with store.session() as cs:
        rows = cs.execute(text('SELECT id, name, colour, kind, origin, hotkey, archived FROM catalogue_type'))
        return {r["name"]: dict(r) for r in rows.mappings()}


def needs_classification(catalogue) -> bool:
    from sqlalchemy import text

    store = getattr(catalogue, "catalogue", catalogue)
    with store.session() as cs:
        return cs.execute(
            text("SELECT value FROM catalogue_meta WHERE key = 'needs_classification'")
        ).scalar_one_or_none() is not None


def class_id_map(handle) -> dict[str, str]:
    from sqlalchemy import text

    with handle.session() as s:
        return dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all())


def add_library_model(library, model_id: str, class_map: dict | None = None) -> None:
    from sqlalchemy import text

    with library.session() as ls:
        ls.execute(
            text(
                "INSERT INTO library_model (id, name, notes, task, format, origin, weights_path, class_names,"
                " class_aliases, provenance, hyperparameters, exports, artifacts, sha256, created_at, class_map)"
                " VALUES (:id, 'M', '', 'detect', 'pt', 'imported', 'models/m/weights.pt', '[]', '{}', '{}',"
                " '{}', '{}', '{}', :sha, :t, :cm)"
            ),
            {"id": model_id, "sha": model_id.ljust(64, "0"), "t": T0, "cm": json.dumps(class_map or {})},
        )
```

- [ ] **Step 5: Run the guard to verify it fails**

Run: `& $PY -m pytest tests/test_migration_ports.py -v`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.migration.ports'`.

- [ ] **Step 6: Write `app/migration/ports.py`**

Write this with the names from Step 3. The spec names are shown here.

```python
"""Everything the migration steps use from units BC (catalogue, findings) and BM (library
datasets, class maps), in one file (foundation spec §7, §8, §12).

Plain SQL against the tables and columns the spec fixes, so the steps depend on the schema, not
on Python names another unit was free to choose. `tests/test_migration_ports.py` checks every
column named here against the merged migrations: when it fails, fix this file, not the steps.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.catalogue.handle import open_catalogue_db  # BC: open catalogue.db under a data dir
from app.catalogue.service import normalise_name  # BC: the name rule (spec §7.1)
from app.db.base import new_id
from app.findings import counts as finding_counts  # BC: the only writer of the counts (spec §8.4)

__all__ = ["normalise_name", "open_catalogue_db"]

CATALOGUE_TYPE = ("id", "name", "colour", "kind", "default_severity", "hotkey", "group", "archived", "origin",
                  "created_at", "updated_at")
CATALOGUE_META = ("key", "value")
PROJECT_TYPE = ("type_id", "position", "hotkey_override", "name", "colour", "kind", "default_severity", "hotkey",
                "group")
CLASS_ID_MAP = ("old_class_id", "type_id")
FINDING = ("id", "number", "type_id", "severity", "status", "note", "created_by", "confidence", "anchor_kind",
           "image_id", "annotation_id", "lon", "lat", "data_type", "data_id", "created_at", "updated_at",
           "reviewed_at")
FINDING_COUNT = ("status", "severity", "type_id", "n")
ACTIVITY = ("id", "at", "kind", "subject_id", "summary", "payload")
LIBRARY_MODEL = ("id", "class_map")
LIBRARY_DATASET = ("id", "name", "task", "origin", "filter", "classes", "split_method", "split_params", "state",
                   "counts", "export_path", "export_state", "legacy_path", "job_id", "created_at")
DATASET_SOURCE = ("dataset_id", "project_id", "project_folder", "project_name", "image_count")
NEEDS_CLASSIFICATION = "needs_classification"
_TYPE_COLUMNS = 'id, name, colour, kind, default_severity, hotkey, "group"'


class MigrationBlocked(Exception):
    """A store the step needs is not open: the job fails with this message, and Retry re-runs it."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def now() -> str:
    return datetime.now(UTC).replace(tzinfo=None).isoformat(sep=" ")


def require_catalogue(catalogue):
    if catalogue is None:
        raise MigrationBlocked("The catalogue is not open, so the project's classes cannot be merged into it.")
    return catalogue


def require_library(library):
    if library is None:
        raise MigrationBlocked("The model library is not open.")
    return library


# ---- catalogue.db --------------------------------------------------------------------------------


def find_type(cs: Session, name: str) -> dict | None:
    """The non-archived type whose name normalises like `name` (spec §7.1), oldest first."""
    key = normalise_name(name)
    rows = cs.execute(
        text(f"SELECT {_TYPE_COLUMNS} FROM catalogue_type WHERE archived = 0 ORDER BY created_at, id")
    ).mappings()
    return next((dict(r) for r in rows if normalise_name(r["name"]) == key), None)


def hotkey_free(cs: Session, hotkey: str) -> bool:
    found = cs.execute(
        text("SELECT 1 FROM catalogue_type WHERE hotkey = :h AND archived = 0 LIMIT 1"), {"h": hotkey}
    ).first()
    return found is None


def create_type(cs: Session, *, name: str, colour: str, hotkey: str | None) -> str:
    """A migrated type: kind `object` (F4), origin `migrated`, no severity, no group."""
    type_id, stamp = new_id(), now()
    cs.execute(
        text(
            'INSERT INTO catalogue_type (id, name, colour, kind, default_severity, hotkey, "group", archived,'
            " origin, created_at, updated_at) VALUES (:id, :name, :colour, 'object', NULL, :hotkey, NULL, 0,"
            " 'migrated', :t, :t)"
        ),
        {"id": type_id, "name": name, "colour": colour, "hotkey": hotkey, "t": stamp},
    )
    return type_id


def flag_needs_classification(cs: Session) -> None:
    cs.execute(
        text("INSERT OR REPLACE INTO catalogue_meta (key, value) VALUES (:k, 'true')"), {"k": NEEDS_CLASSIFICATION}
    )


def type_rows(cs: Session, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    params = {f"i{n}": i for n, i in enumerate(ids)}
    placeholders = ", ".join(f":{k}" for k in params)
    rows = cs.execute(text(f"SELECT {_TYPE_COLUMNS} FROM catalogue_type WHERE id IN ({placeholders})"), params)
    return {r["id"]: dict(r) for r in rows.mappings()}


# ---- project.db ----------------------------------------------------------------------------------


def insert_project_type(s: Session, *, type_id: str, position: int, hotkey_override: str | None,
                        snapshot: dict) -> None:
    s.execute(
        text(
            'INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind, default_severity,'
            ' hotkey, "group") VALUES (:type_id, :position, :override, :name, :colour, :kind, :severity,'
            " :hotkey, :grp)"
        ),
        {"type_id": type_id, "position": position, "override": hotkey_override, "name": snapshot["name"],
         "colour": snapshot["colour"], "kind": snapshot["kind"], "severity": snapshot["default_severity"],
         "hotkey": snapshot["hotkey"], "grp": snapshot["group"]},
    )


def rebuild_counts(s: Session) -> None:
    finding_counts.recount(s)


def add_activity_once(s: Session, *, kind: str, subject_id: str, summary: str, payload: dict) -> bool:
    exists = s.execute(
        text("SELECT 1 FROM activity WHERE kind = :k AND subject_id = :s AND summary = :m LIMIT 1"),
        {"k": kind, "s": subject_id, "m": summary},
    ).first()
    if exists is not None:
        return False
    s.execute(
        text("INSERT INTO activity (id, at, kind, subject_id, summary, payload) VALUES (:id, :at, :k, :s, :m, :p)"),
        {"id": new_id(), "at": now(), "k": kind, "s": subject_id, "m": summary, "p": json.dumps(payload)},
    )
    return True


# ---- library.db ----------------------------------------------------------------------------------


def merge_class_map(ls: Session, model_id: str, mapping: dict):
    """Merge a project's {model class name: type id | None} into the model's app-wide map. The first
    mapping wins (spec §11.4 step 4). None when the model is not in the library."""
    row = ls.execute(text("SELECT class_map FROM library_model WHERE id = :id"), {"id": model_id}).first()
    if row is None:
        return None
    current = json.loads(row[0]) if row[0] else {}
    added, clashes = 0, []
    for name, type_id in mapping.items():
        if name not in current:
            current[name] = type_id
            added += 1
        elif current[name] != type_id:
            clashes.append((name, current[name], type_id))
    if added:
        ls.execute(text("UPDATE library_model SET class_map = :m WHERE id = :id"),
                   {"m": json.dumps(current), "id": model_id})
    return added, clashes


def legacy_dataset_by_path(ls: Session, path: str) -> str | None:
    return ls.execute(
        text("SELECT id FROM dataset WHERE origin = 'legacy' AND legacy_path = :p"), {"p": path}
    ).scalar_one_or_none()


def unique_dataset_name(ls: Session, wanted: str) -> str:
    taken = {n.casefold() for n in ls.execute(text("SELECT name FROM dataset")).scalars()}
    name, n = wanted, 2
    while name.casefold() in taken:
        name, n = f"{wanted} {n}", n + 1
    return name


def insert_legacy_dataset(ls: Session, *, name: str, classes: list[dict], split_method: str, split_params: dict,
                          counts: dict, legacy_path: str, filter: dict) -> str:
    dataset_id = new_id()
    ls.execute(
        text(
            "INSERT INTO dataset (id, name, task, origin, filter, classes, split_method, split_params, state,"
            " counts, export_path, export_state, legacy_path, job_id, created_at) VALUES (:id, :name, 'detect',"
            " 'legacy', :filter, :classes, :method, :params, 'ready', :counts, NULL, 'ready', :path, NULL, :t)"
        ),
        {"id": dataset_id, "name": name, "filter": json.dumps(filter), "classes": json.dumps(classes),
         "method": split_method, "params": json.dumps(split_params), "counts": json.dumps(counts),
         "path": legacy_path, "t": now()},
    )
    return dataset_id


def insert_dataset_source(ls: Session, *, dataset_id: str, project_id: str, project_folder: str,
                          project_name: str, image_count: int) -> None:
    ls.execute(
        text(
            "INSERT INTO dataset_source (dataset_id, project_id, project_folder, project_name, image_count)"
            " VALUES (:d, :p, :f, :n, :c)"
        ),
        {"d": dataset_id, "p": project_id, "f": project_folder, "n": project_name, "c": image_count},
    )
```

- [ ] **Step 7: Run the guard to verify it passes**

Run: `& $PY -m pytest tests/test_migration_ports.py -v`
Expected: 5 passed. If a `_missing` assertion lists columns, BC or BM named them differently. Change `ports.py` (the tuples and the SQL) to the merged names, not the test.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/migration/ports.py backend/tests/test_migration_ports.py backend/tests/migration_helpers.py
git commit -m "feat(migration): one ports module for the catalogue, findings and library tables" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Step 1, `catalogue_merge`

**Files:**
- Modify: `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_step_catalogue.py`

**Interfaces:**
- Consumes: `ports.require_catalogue`, `find_type`, `hotkey_free`, `create_type`, `flag_needs_classification`; `StepContext`.
- Produces:
  - `steps.STORE_LOCK: threading.Lock`: held around every catalogue or library write section
  - `steps.DEFAULT_COLOUR = "#4f46e5"`
  - `steps.old_classes(ctx) -> list[dict]`: `Project.classes` in `order`, skipping blank ones
  - `steps.catalogue_merge(ctx) -> {"types_merged": int, "types_created": int, "merged": [str], "created": [str]}`
  - `class_id_map` rows `(old_class_id, type_id)` for every class

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_step_catalogue.py`:

```python
"""Step 1: classes merge into the catalogue by name, as migrated object types (spec §11.4, F4)."""

import threading
import time

import pytest
from migration_helpers import (
    at_revision,
    catalogue_types,
    class_id_map,
    env_for,
    needs_classification,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import ports, steps
from app.migration.ports import MigrationBlocked


def _class(cid, name, colour="#06b6d4", hotkey=None, order=0):
    return {"id": cid, "name": name, "colour": colour, "hotkey": hotkey, "order": order}


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _project(tmp_path, name, classes):
    return open_handle(at_revision(tmp_path / name, "0009", pid=f"p-{name}", name=name, classes=classes))


def test_classes_merge_by_name_across_projects(tmp_path, stores):
    a = _project(tmp_path, "a", [_class("a-dump", "dump_truck", "#06b6d4", "2")])
    b = _project(tmp_path, "b", [_class("b-dump", "Dump truck", "#ff0000"), _class("b-crane", "crane", "#3b82f6", "2", 1)])
    da = run_step(a, env_for(stores, a.folder), steps.catalogue_merge)
    db_ = run_step(b, env_for(stores, b.folder), steps.catalogue_merge)
    assert (da["types_created"], da["types_merged"]) == (1, 0)
    assert (db_["types_created"], db_["types_merged"]) == (1, 1)
    types = catalogue_types(stores)
    assert set(types) == {"dump_truck", "crane"}
    assert types["dump_truck"]["colour"] == "#06b6d4"  # the first project's colour wins
    assert all(t["kind"] == "object" and t["origin"] == "migrated" for t in types.values())
    assert types["dump_truck"]["hotkey"] == "2" and types["crane"]["hotkey"] is None  # "2" was taken
    assert class_id_map(a) == {"a-dump": types["dump_truck"]["id"]}
    assert class_id_map(b) == {"b-dump": types["dump_truck"]["id"], "b-crane": types["crane"]["id"]}
    assert needs_classification(stores)


def test_an_existing_defect_type_absorbs_the_class_and_keeps_its_kind(tmp_path, stores):
    with stores.catalogue.session() as cs:
        crack = ports.create_type(cs, name="Crack", colour="#ef4444", hotkey="c")
        cs.execute(text("UPDATE catalogue_type SET kind = 'defect', origin = 'user' WHERE id = :id"), {"id": crack})
    p = _project(tmp_path, "p", [_class("c-crack", "crack")])
    detail = run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert detail["types_created"] == 0 and class_id_map(p) == {"c-crack": crack}
    assert catalogue_types(stores)["Crack"]["kind"] == "defect"
    assert not needs_classification(stores)  # nothing new to classify


def test_two_spellings_in_one_project_become_one_type(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("old", "Dump truck"), _class("new", "dump_truck", order=1)])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert len(catalogue_types(stores)) == 1
    ids = class_id_map(p)
    assert ids["old"] == ids["new"]


def test_an_archived_match_does_not_absorb_the_class(tmp_path, stores):
    with stores.catalogue.session() as cs:
        old = ports.create_type(cs, name="crane", colour="#3b82f6", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET archived = 1 WHERE id = :id"), {"id": old})
    p = _project(tmp_path, "p", [_class("c-crane", "crane")])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert class_id_map(p)["c-crane"] != old


def test_a_rerun_creates_nothing_and_keeps_the_ids(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("c1", "excavator"), _class("c2", "roller", order=1)])
    run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    first = class_id_map(p)
    again = run_step(p, env_for(stores, p.folder), steps.catalogue_merge)
    assert (again["types_created"], again["types_merged"]) == (0, 2)
    assert class_id_map(p) == first and len(catalogue_types(stores)) == 2


def test_without_the_catalogue_the_step_is_blocked(tmp_path, stores):
    p = _project(tmp_path, "p", [_class("c1", "excavator")])
    env = env_for(stores, p.folder)
    env.catalogue = None
    with pytest.raises(MigrationBlocked, match="catalogue"):
        run_step(p, env, steps.catalogue_merge)


def test_two_projects_merging_at_once_create_one_type(tmp_path, stores, monkeypatch):
    a = _project(tmp_path, "a", [_class("a-dump", "dump_truck")])
    b = _project(tmp_path, "b", [_class("b-dump", "Dump truck")])
    real_find = ports.find_type

    def slow_find(cs, name):  # widen the window between "not found" and "create"
        found = real_find(cs, name)
        time.sleep(0.2)
        return found

    monkeypatch.setattr(ports, "find_type", slow_find)
    errors = []

    def merge(h):
        try:
            run_step(h, env_for(stores, h.folder), steps.catalogue_merge)
        except Exception as e:  # noqa: BLE001 - the assertion below reports it
            errors.append(e)

    threads = [threading.Thread(target=merge, args=(h,)) for h in (a, b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [] and len(catalogue_types(stores)) == 1
    assert class_id_map(a)["a-dump"] == class_id_map(b)["b-dump"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_step_catalogue.py -v`
Expected: FAIL with `AttributeError: module 'app.migration.steps' has no attribute 'catalogue_merge'`.

- [ ] **Step 3: Implement step 1**

Replace `backend/app/migration/steps.py` with:

```python
"""The migration's data steps (foundation spec §11.4), in order.

Each step's project writes and its ledger record commit together (`app.migration.pipeline`).
Writes to the catalogue and the library commit separately, so every step is idempotent on its
own: a re-run after a crash finds what it wrote and writes nothing twice. `STORE_LOCK` serialises
the catalogue and library write sections: the library runner runs two upgrades at once, and two
projects must not both create "dump_truck".

`PIPELINE` stays empty until Task 15 arms it (see the ADR
2026-09-26-migration-framework-ships-disarmed).
"""

from __future__ import annotations

import threading

from sqlalchemy import text

from app.migration import ports
from app.migration.pipeline import Step, StepContext

DEFAULT_COLOUR = "#4f46e5"
STORE_LOCK = threading.Lock()


def old_classes(ctx: StepContext) -> list[dict]:
    """The project's old classes in their order: the migration's input, only read (spec §6.1)."""
    raw = ctx.handle.row(ctx.session).classes or []
    usable = [c for c in raw if isinstance(c, dict) and c.get("id") and (c.get("name") or "").strip()]
    return sorted(usable, key=lambda c: c.get("order", 0))


def catalogue_merge(ctx: StepContext) -> dict:
    """Step 1: find each class's catalogue type by name, or create it as a migrated `object` type
    with the class colour and, if free, its hotkey; write `class_id_map`; flag the new types for
    classification (spec §11.4, F4)."""
    catalogue = ports.require_catalogue(ctx.env.catalogue)
    merged, created, pairs = [], [], []
    with STORE_LOCK, catalogue.session() as cs:
        for c in old_classes(ctx):
            name = c["name"].strip()
            found = ports.find_type(cs, name)
            if found is not None:
                type_id = found["id"]
                merged.append(name)
            else:
                hotkey = c.get("hotkey") or None
                if hotkey and not ports.hotkey_free(cs, hotkey):
                    hotkey = None
                type_id = ports.create_type(cs, name=name, colour=c.get("colour") or DEFAULT_COLOUR, hotkey=hotkey)
                cs.flush()
                created.append(name)
            pairs.append((c["id"], type_id))
        if created:
            ports.flag_needs_classification(cs)
    for old, new in pairs:
        ctx.session.execute(
            text("INSERT OR REPLACE INTO class_id_map (old_class_id, type_id) VALUES (:old, :new)"),
            {"old": old, "new": new},
        )
    return {"types_merged": len(merged), "types_created": len(created), "merged": merged, "created": created}


PIPELINE: tuple[Step, ...] = ()
```

`with STORE_LOCK, catalogue.session() as cs:` takes the lock first and commits the catalogue before releasing it, so the second project sees the first project's type.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_step_catalogue.py -v`
Expected: 7 passed. To confirm the concurrency test really tests the lock, remove `STORE_LOCK, ` from the `with` line: the test must then fail with two types or an integrity error. Put the lock back.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/steps.py backend/tests/test_migration_step_catalogue.py
git commit -m "feat(migration): step 1 merges project classes into the catalogue by name" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Step 2, `rewrite_class_ids`

**Files:**
- Create: `backend/app/migration/rekey.py`
- Modify: `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_rekey.py`, `backend/tests/test_migration_step_rewrite.py`

**Interfaces:**
- Consumes: `class_id_map` from step 1.
- Produces:
  - `rekey`:
    - `rekey_counts(counts: dict | None, mapping) -> dict`
    - `rekey_area_counts(area_counts: dict | None, mapping) -> dict`
    - `remap_values(class_map: dict | None, mapping) -> dict`
    - `remap_classes(classes: list | None, mapping) -> list`
  - `steps.ROW_TABLES = ("box", "map_detection", "map_label")`
  - `steps.rewrite_class_ids(ctx) -> {"rows_rewritten": {table: n}, "json_rows": int, "classes_changed": int, "warnings": [str]}`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_rekey.py`:

```python
"""JSON rekeying for step 2 (spec §11.4): counts follow their class, and merged classes sum."""

from app.migration.rekey import rekey_area_counts, rekey_counts, remap_classes, remap_values

M = {"old-a": "new-a", "old-b": "new-b", "old-b2": "new-b"}


def test_counts_follow_their_class_and_merge_when_two_classes_became_one():
    got = rekey_counts({"old-a": 3, "old-b": 1, "old-b2": 2, "gone": 4}, M)
    assert got == {"new-a": 3, "new-b": 3, "gone": 4}


def test_area_counts_sum_each_field():
    area = {"area1": {"old-b": {"total": 1, "verified": 0}, "old-b2": {"total": 2, "verified": 2}}, "area2": {}}
    assert rekey_area_counts(area, M) == {"area1": {"new-b": {"total": 3, "verified": 2}}, "area2": {}}


def test_class_map_values_follow_and_ignored_classes_stay_ignored():
    assert remap_values({"truck": "old-b", "bird": None, "x": "gone"}, M) == {"truck": "new-b", "bird": None, "x": "gone"}


def test_dataset_classes_keep_their_names_and_order():
    classes = [{"id": "old-a", "name": "excavator", "order": 0}, {"id": "old-b", "name": "dump_truck", "order": 1}]
    assert remap_classes(classes, M) == [
        {"id": "new-a", "name": "excavator", "order": 0},
        {"id": "new-b", "name": "dump_truck", "order": 1},
    ]


def test_rekeying_twice_changes_nothing_and_null_reads_as_empty():
    once = rekey_counts({"old-a": 1}, M)
    assert rekey_counts(once, M) == once
    assert rekey_counts(None, M) == {} and rekey_area_counts(None, M) == {}
    assert remap_values(None, M) == {} and remap_classes(None, M) == []
```

Create `backend/tests/test_migration_step_rewrite.py`:

```python
"""Step 2: class ids become catalogue type ids on every table and JSON shape (spec §11.4, §16)."""

import json

import pytest
from migration_helpers import (
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    at_revision,
    catalogue_types,
    db,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import steps
from app.migration.invariants import compare, snapshot


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _one(handle, sql):
    with handle.session() as s:
        return s.execute(text(sql)).one()


def test_every_table_and_json_shape_points_at_type_ids(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    add_dataset(folder)
    before = snapshot(folder / "project.db")
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    detail = run_step(h, env, steps.rewrite_class_ids)
    ids = {name: row["id"] for name, row in catalogue_types(stores).items()}
    exc, dump = ids["excavator"], ids["dump_truck"]
    assert detail["rows_rewritten"] == {"box": 10, "map_detection": 4, "map_label": 1}
    with h.session() as s:
        assert set(s.execute(text("SELECT DISTINCT class_id FROM box")).scalars()) == {exc, dump}
        assert set(s.execute(text("SELECT DISTINCT class_id FROM map_detection")).scalars()) == {exc, dump}
    counts, verified, area, class_map = (json.loads(v) for v in _one(
        h, "SELECT counts, verified_counts, area_counts, class_map FROM map_run"))
    assert counts == {exc: 3, dump: 1} and verified == {exc: 1}
    assert area == {"area1": {exc: {"total": 2, "verified": 1}, dump: {"total": 1, "verified": 0}}}
    assert class_map == {"excavator": exc, "truck": dump, "person": None}
    q_counts, q_map = (json.loads(v) for v in _one(h, "SELECT counts, class_map FROM query_run"))
    assert q_counts == {exc: 2} and q_map == {"excavator": exc}
    assert json.loads(_one(h, "SELECT mapping FROM model_class_map")[0]) == {"excavator": exc, "truck": dump, "bird": None}
    assert [c["id"] for c in json.loads(_one(h, "SELECT classes FROM dataset")[0])] == [exc, dump]
    frozen = json.loads(_one(h, "SELECT boxes FROM dataset_image")[0])
    assert {b["class_id"] for b in frozen} == {"c-exc", "c-dump"}  # spec: not rewritten
    h.engine.dispose()
    assert compare(before, snapshot(folder / "project.db")) == []


def test_a_box_on_a_deleted_class_keeps_its_id_and_is_reported(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    with db(folder) as con:
        con.execute("UPDATE box SET class_id = 'c-deleted' WHERE id = 'b-c-exc-0'")
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    detail = run_step(h, env, steps.rewrite_class_ids)
    assert detail["rows_rewritten"]["box"] == 9
    assert any(w.startswith("box: 1 row(s)") for w in detail["warnings"])
    with h.session() as s:
        assert s.execute(text("SELECT class_id FROM box WHERE id = 'b-c-exc-0'")).scalar_one() == "c-deleted"


def test_a_rerun_rewrites_nothing(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_step(h, env, steps.catalogue_merge)
    run_step(h, env, steps.rewrite_class_ids)
    first = _one(h, "SELECT counts, area_counts FROM map_run")
    again = run_step(h, env, steps.rewrite_class_ids)
    assert again["rows_rewritten"] == {"box": 0, "map_detection": 0, "map_label": 0}
    assert _one(h, "SELECT counts, area_counts FROM map_run") == first
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_rekey.py tests/test_migration_step_rewrite.py -v`
Expected: FAIL. `test_migration_rekey.py` fails at collection with `ModuleNotFoundError: No module named 'app.migration.rekey'`, and the step tests fail with `AttributeError: … 'rewrite_class_ids'`.

- [ ] **Step 3: Write `app/migration/rekey.py`**

```python
"""Rekeying the JSON that names old class ids (foundation spec §11.4 step 2). Pure functions.

Two old classes may map to one type (two spellings of one name), so counts are **summed** under
the new key, never overwritten. Keys and values with no mapping are kept as they are: after a
first run nothing maps any more, so a second run changes nothing.
"""


def rekey_counts(counts: dict | None, mapping: dict[str, str]) -> dict:
    """{class_id: n} -> {type_id: n}."""
    out: dict = {}
    for key, n in (counts or {}).items():
        new = mapping.get(key, key)
        out[new] = out.get(new, 0) + n
    return out


def rekey_area_counts(area_counts: dict | None, mapping: dict[str, str]) -> dict:
    """{area_id: {class_id: {"total": n, "verified": n}}} -> the same keyed by type id."""
    out: dict = {}
    for area, per_class in (area_counts or {}).items():
        merged: dict = {}
        for key, fields in (per_class or {}).items():
            target = merged.setdefault(mapping.get(key, key), {})
            for field, n in (fields or {}).items():
                target[field] = target.get(field, 0) + n
        out[area] = merged
    return out


def remap_values(class_map: dict | None, mapping: dict[str, str]) -> dict:
    """{model class name: class_id | None} -> {model class name: type_id | None}."""
    return {name: (mapping.get(v, v) if v else v) for name, v in (class_map or {}).items()}


def remap_classes(classes: list | None, mapping: dict[str, str]) -> list:
    """A dataset's frozen [{id, name, ...}]: the id follows, the name and order stay."""
    return [{**c, "id": mapping.get(c.get("id"), c.get("id"))} for c in (classes or [])]
```

- [ ] **Step 4: Implement step 2**

In `backend/app/migration/steps.py`, add `import json` at the top and `from app.migration.rekey import rekey_area_counts, rekey_counts, remap_classes, remap_values`. Then add above `PIPELINE`:

```python
ROW_TABLES = ("box", "map_detection", "map_label")
# (table, key column, {json column: rekey function}): run rows are tens per project.
JSON_ROWS = (
    ("query_run", "id", {"counts": rekey_counts, "verified_counts": rekey_counts, "class_map": remap_values}),
    ("map_run", "id", {"counts": rekey_counts, "verified_counts": rekey_counts,
                       "area_counts": rekey_area_counts, "class_map": remap_values}),
    ("model_class_map", "library_model_id", {"mapping": remap_values}),
    ("dataset", "id", {"classes": remap_classes}),
)


def _rewrite_json(s, table: str, key: str, columns: dict, mapping: dict[str, str]) -> int:
    names = ", ".join(columns)
    changed = 0
    for row in s.execute(text(f"SELECT {key}, {names} FROM {table}")).mappings().all():
        values = {}
        for column, fn in columns.items():
            old = json.loads(row[column]) if row[column] else None
            new = fn(old, mapping)
            if new != (old if old is not None else type(new)()):
                values[column] = json.dumps(new)
        if values:
            sets = ", ".join(f"{c} = :{c}" for c in values)
            s.execute(text(f"UPDATE {table} SET {sets} WHERE {key} = :key"), {**values, "key": row[key]})
            changed += 1
    return changed


def rewrite_class_ids(ctx: StepContext) -> dict:
    """Step 2: point every class id at its catalogue type id, where old differs from new. Row
    tables with one set-based UPDATE each (no row is loaded); JSON only on run, model-map and
    dataset rows. `dataset_image.boxes` is not rewritten: legacy datasets train from their
    materialised data.yaml, whose class names are unchanged (spec §11.4)."""
    s = ctx.session
    mapping = dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map WHERE old_class_id != type_id")).all())
    rows = {}
    for table in ROW_TABLES:
        result = s.execute(
            text(
                f"UPDATE {table} SET class_id = (SELECT m.type_id FROM class_id_map m"
                f" WHERE m.old_class_id = {table}.class_id)"
                " WHERE class_id IN (SELECT old_class_id FROM class_id_map WHERE old_class_id != type_id)"
            )
        )
        rows[table] = result.rowcount
    json_rows = sum(_rewrite_json(s, table, key, columns, mapping) for table, key, columns in JSON_ROWS)
    warnings = []
    for table in ROW_TABLES:
        orphans = s.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE class_id NOT IN (SELECT type_id FROM class_id_map)")
        ).scalar_one()
        if orphans:
            warnings.append(
                f"{table}: {orphans} row(s) use a class that is not in the project's class list"
                " and keep their old class id"
            )
    return {"rows_rewritten": rows, "json_rows": json_rows, "classes_changed": len(mapping), "warnings": warnings}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_rekey.py tests/test_migration_step_rewrite.py -v`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/migration/rekey.py backend/app/migration/steps.py backend/tests/test_migration_rekey.py backend/tests/test_migration_step_rewrite.py
git commit -m "feat(migration): step 2 rewrites class ids to catalogue type ids, rows and JSON" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Steps 3 and 4, `project_types` and `library_class_maps`

**Files:**
- Modify: `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_step_types.py`

**Interfaces:**
- Consumes: `class_id_map` (step 1), `old_classes`, `STORE_LOCK`, `ports.type_rows`, `insert_project_type`, `require_library`, `merge_class_map`; model class maps already rewritten by step 2.
- Produces:
  - `steps.project_types(ctx) -> {"types": int, "hotkey_overrides": int, "warnings": [str]}`
  - `steps.library_class_maps(ctx) -> {"models": int, "names_added": int, "conflicts": int, "warnings": [str]}`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_step_types.py`:

```python
"""Step 3 (project_type from class_id_map) and step 4 (class maps into the library), spec §11.4."""

import json

import pytest
from migration_helpers import (
    add_detect_rows,
    add_library_model,
    at_revision,
    catalogue_types,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import steps


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _cls(cid, name, hotkey=None, order=0):
    return {"id": cid, "name": name, "colour": "#06b6d4", "hotkey": hotkey, "order": order}


def _types(handle):
    with handle.session() as s:
        return [dict(r) for r in s.execute(text(
            "SELECT type_id, position, hotkey_override, name, kind, hotkey FROM project_type ORDER BY position"
        )).mappings()]


def _through(handle, stores, *fns):
    env = env_for(stores, handle.folder)
    return [run_step(handle, env, fn) for fn in fns]


def test_types_keep_the_old_order_and_carry_snapshots(tmp_path, stores):
    classes = [_cls("c2", "roller", "2", 1), _cls("c1", "excavator", "1", 0)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    *_, detail = _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    assert detail == {"types": 2, "hotkey_overrides": 0, "warnings": []}
    assert [(t["type_id"], t["position"], t["name"], t["kind"], t["hotkey"]) for t in _types(h)] == [
        (ids["excavator"], 0, "excavator", "object", "1"),
        (ids["roller"], 1, "roller", "object", "2"),
    ]


def test_a_project_keeps_its_own_hotkey_when_it_clashes_with_nothing(tmp_path, stores):
    first = open_handle(at_revision(tmp_path / "a", "0009", pid="pa", classes=[_cls("a1", "crane", "4")]))
    _through(first, stores, steps.catalogue_merge)
    second = open_handle(at_revision(tmp_path / "b", "0009", pid="pb",
                                     classes=[_cls("b1", "crane", "5"), _cls("b2", "roller", "4", 1)]))
    *_, detail = _through(second, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(second)}
    assert rows["crane"]["hotkey"] == "4" and rows["crane"]["hotkey_override"] == "5"
    assert rows["roller"]["hotkey"] is None and rows["roller"]["hotkey_override"] is None  # "4" is crane's
    assert detail["hotkey_overrides"] == 1 and any("roller" in w for w in detail["warnings"])


def test_duplicate_types_get_one_row_in_the_old_order(tmp_path, stores):
    classes = [_cls("old", "Dump truck"), _cls("x", "excavator", order=1), _cls("new", "dump_truck", order=2)]
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=classes))
    _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)
    assert [t["name"] for t in _types(h)] == ["Dump truck", "excavator"]


def test_existing_project_type_rows_are_kept(tmp_path, stores):
    h = open_handle(at_revision(tmp_path / "p", "0009", classes=[_cls("c1", "excavator"), _cls("c2", "crane", order=1)]))
    _through(h, stores, steps.catalogue_merge)
    crane = catalogue_types(stores)["crane"]["id"]
    with h.session() as s:  # written by BC's create before this unit armed
        s.execute(text('INSERT INTO project_type (type_id, position, hotkey_override, name, colour, kind,'
                       ' default_severity, hotkey, "group") VALUES (:t, 0, \'9\', \'crane\', \'#000000\','
                       " 'object', NULL, NULL, NULL)"), {"t": crane})
    *_, detail = _through(h, stores, steps.rewrite_class_ids, steps.project_types)
    rows = {t["name"]: t for t in _types(h)}
    assert detail["types"] == 1 and rows["crane"]["hotkey_override"] == "9" and rows["excavator"]["position"] == 1
    assert _through(h, stores, steps.project_types)[0]["types"] == 0  # a rerun adds nothing


def test_model_class_maps_move_into_the_library_first_mapping_wins(tmp_path, stores):
    add_library_model(stores.library, "lib-m1", {"bird": "t-bird"})
    a = at_revision(tmp_path / "a", "0009", pid="pa")
    add_detect_rows(a)
    ha = open_handle(a)
    *_, detail = _through(ha, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.library_class_maps)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    with stores.library.session() as ls:
        merged = json.loads(ls.execute(text("SELECT class_map FROM library_model WHERE id = 'lib-m1'")).scalar_one())
    assert merged == {"bird": "t-bird", "excavator": ids["excavator"], "truck": ids["dump_truck"]}
    assert (detail["names_added"], detail["conflicts"]) == (2, 1)  # "bird": None here vs t-bird
    again = _through(ha, stores, steps.library_class_maps)[0]
    assert (again["names_added"], again["conflicts"]) == (0, 1)


def test_a_model_missing_from_the_library_is_reported(tmp_path, stores):
    a = at_revision(tmp_path / "a", "0009")
    add_detect_rows(a)
    h = open_handle(a)
    *_, detail = _through(h, stores, steps.catalogue_merge, steps.rewrite_class_ids, steps.library_class_maps)
    assert detail["models"] == 1 and any("lib-m1" in w and "not in the library" in w for w in detail["warnings"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_step_types.py -v`
Expected: FAIL with `AttributeError: module 'app.migration.steps' has no attribute 'project_types'`.

- [ ] **Step 3: Implement steps 3 and 4**

Add to `backend/app/migration/steps.py` above `PIPELINE`:

```python
def project_types(ctx: StepContext) -> dict:
    """Step 3: fill `project_type` from `class_id_map` in the old class order, with snapshots of the
    catalogue types (spec §7.3, F2). Rows already present (written by `create` since BC) are kept.
    A project keeps its old hotkey as `hotkey_override` when that key clashes with no catalogue
    hotkey of another type in the project and no override already given."""
    s = ctx.session
    catalogue = ports.require_catalogue(ctx.env.catalogue)
    id_map = dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all())
    existing = dict(s.execute(text("SELECT type_id, position FROM project_type")).all())
    used = {k for (k,) in s.execute(text("SELECT COALESCE(hotkey_override, hotkey) FROM project_type")) if k}
    ordered, wanted = [], {}
    for c in old_classes(ctx):
        type_id = id_map.get(c["id"])
        if type_id is None or type_id in ordered:
            continue
        ordered.append(type_id)
        wanted[type_id] = c.get("hotkey") or None
    with catalogue.session() as cs:
        snaps = ports.type_rows(cs, ordered)
    missing = [t for t in ordered if t not in snaps]
    if missing:
        raise RuntimeError(f"class_id_map points at types the catalogue does not have: {missing}")
    catalogue_keys = {snaps[t]["hotkey"] for t in ordered if snaps[t]["hotkey"]}
    position = max(existing.values(), default=-1) + 1
    added = overrides = 0
    warnings = []
    for type_id in ordered:
        if type_id in existing:
            continue
        snap, key = snaps[type_id], wanted[type_id]
        override = None
        if key and key != snap["hotkey"]:
            if key in catalogue_keys or key in used:
                warnings.append(f"hotkey {key} of {snap['name']} is taken in this project; it uses "
                                f"{snap['hotkey'] or 'no hotkey'}")
            else:
                override = key
                overrides += 1
        effective = override or snap["hotkey"]
        if effective:
            used.add(effective)
        ports.insert_project_type(s, type_id=type_id, position=position, hotkey_override=override, snapshot=snap)
        position += 1
        added += 1
    return {"types": added, "hotkey_overrides": overrides, "warnings": warnings}


def library_class_maps(ctx: StepContext) -> dict:
    """Step 4: merge the project's `model_class_map` (values already type ids, step 2) into
    `library_model.class_map`. The first mapping wins; a conflict is reported (spec §11.4, F10)."""
    library = ports.require_library(ctx.env.library)
    rows = ctx.session.execute(text("SELECT library_model_id, mapping FROM model_class_map")).all()
    names_added = conflicts = 0
    warnings = []
    with STORE_LOCK, library.session() as ls:
        for model_id, raw in rows:
            outcome = ports.merge_class_map(ls, model_id, json.loads(raw) if raw else {})
            if outcome is None:
                warnings.append(f"model {model_id} is not in the library; its class mapping was not carried over")
                continue
            added, clashes = outcome
            names_added += added
            for name, kept, ours in clashes:
                conflicts += 1
                warnings.append(f"model {model_id}: {name!r} stays mapped to {kept}; this project mapped it to {ours}")
    return {"models": len(rows), "names_added": names_added, "conflicts": conflicts, "warnings": warnings}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_step_types.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/steps.py backend/tests/test_migration_step_types.py
git commit -m "feat(migration): steps 3 and 4 build the project type list and move class maps to the library" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Step 5, `legacy_datasets`

**Files:**
- Modify: `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_step_datasets.py`

**Interfaces:**
- Consumes: `class_id_map`; `dataset.classes` already rewritten by step 2; `ports.require_library`, `legacy_dataset_by_path`, `unique_dataset_name`, `insert_legacy_dataset`, `insert_dataset_source`; `STORE_LOCK`; `ctx.env.origin_folder`.
- Produces: `steps.legacy_datasets(ctx) -> {"registered": int, "names": [str], "already_registered": int, "warnings": [str]}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_step_datasets.py`:

```python
"""Step 5: materialised project datasets become legacy library datasets (spec §6.1, §11.4, §12.1)."""

import json
import shutil

import pytest
from migration_helpers import (
    add_dataset,
    add_images_and_boxes,
    at_revision,
    catalogue_types,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.migration import steps


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _legacy(stores):
    with stores.library.session() as ls:
        rows = ls.execute(text("SELECT id, name, task, origin, state, export_state, legacy_path, classes, counts,"
                               " filter FROM dataset WHERE origin = 'legacy' ORDER BY name")).mappings()
        return [dict(r) for r in rows]


def _migrate(handle, stores, origin=None):
    env = env_for(stores, origin or handle.folder)
    for fn in (steps.catalogue_merge, steps.rewrite_class_ids):
        run_step(handle, env, fn)
    return run_step(handle, env, steps.legacy_datasets)


def _project(tmp_path, name, pid, project_name="Legacy", materialised=True):
    folder = at_revision(tmp_path / name, "0009", pid=pid, name=project_name)
    add_images_and_boxes(folder)
    add_dataset(folder, materialised=materialised)
    return folder


def test_a_materialised_dataset_is_registered_as_legacy(tmp_path, stores):
    folder = _project(tmp_path, "p", "p1")
    h = open_handle(folder)
    detail = _migrate(h, stores)
    ids = {n: r["id"] for n, r in catalogue_types(stores).items()}
    [row] = _legacy(stores)
    assert detail["registered"] == 1 and detail["names"] == ["v1 (Legacy)"]
    assert (row["name"], row["task"], row["state"], row["export_state"]) == ("v1 (Legacy)", "detect", "ready", "ready")
    assert row["legacy_path"] == str((folder / "datasets" / "v1").resolve())
    assert json.loads(row["classes"]) == [{"type_id": ids["excavator"], "name": "excavator"},
                                          {"type_id": ids["dump_truck"], "name": "dump_truck"}]
    assert json.loads(row["counts"]) == {"images": 1, "per_class": {ids["excavator"]: 1, ids["dump_truck"]: 1},
                                         "train": 1, "val": 0}
    assert json.loads(row["filter"])["project_ids"] == ["p1"]
    with stores.library.session() as ls:
        source = ls.execute(text("SELECT project_id, project_name, image_count FROM dataset_source")).one()
    assert tuple(source) == ("p1", "Legacy", 1)


def test_a_dataset_never_built_on_disk_is_reported_not_registered(tmp_path, stores):
    h = open_handle(_project(tmp_path, "p", "p1", materialised=False))
    detail = _migrate(h, stores)
    assert detail["registered"] == 0 and _legacy(stores) == []
    assert any("v1" in w and "never built" in w for w in detail["warnings"])


def test_a_rerun_registers_nothing_twice(tmp_path, stores):
    h = open_handle(_project(tmp_path, "p", "p1"))
    _migrate(h, stores)
    again = run_step(h, env_for(stores, h.folder), steps.legacy_datasets)
    assert (again["registered"], again["already_registered"]) == (0, 1) and len(_legacy(stores)) == 1


def test_two_projects_with_the_same_name_get_distinct_dataset_names(tmp_path, stores):
    _migrate(open_handle(_project(tmp_path, "a", "pa", "Ahmadia")), stores)
    _migrate(open_handle(_project(tmp_path, "b", "pb", "Ahmadia")), stores)
    assert [r["name"] for r in _legacy(stores)] == ["v1 (Ahmadia)", "v1 (Ahmadia) 2"]


def test_a_dry_run_copy_registers_the_original_folder(tmp_path, stores):
    original = _project(tmp_path, "original", "p1")
    copy = tmp_path / "copy"
    copy.mkdir()
    shutil.copy2(original / "project.db", copy / "project.db")  # the database only, as the dry run does
    _migrate(open_handle(copy), stores, origin=original)
    assert _legacy(stores)[0]["legacy_path"] == str((original / "datasets" / "v1").resolve())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_step_datasets.py -v`
Expected: FAIL with `AttributeError: module 'app.migration.steps' has no attribute 'legacy_datasets'`.

- [ ] **Step 3: Implement step 5**

Add to `backend/app/migration/steps.py` above `PIPELINE`:

```python
def _dataset_counts(s, dataset_id: str, id_map: dict[str, str]) -> dict:
    """Images per split and boxes per type, counted in SQL (`json_each`): no row is loaded."""
    splits = dict(s.execute(
        text("SELECT split, COUNT(*) FROM dataset_image WHERE dataset_id = :d GROUP BY split"), {"d": dataset_id}
    ).all())
    per_class: dict[str, int] = {}
    for old, n in s.execute(
        text("SELECT json_extract(b.value, '$.class_id'), COUNT(*) FROM dataset_image di, json_each(di.boxes) b"
             " WHERE di.dataset_id = :d GROUP BY 1"),
        {"d": dataset_id},
    ).all():
        key = id_map.get(old, old)
        per_class[key] = per_class.get(key, 0) + n
    return {"images": sum(splits.values()), "per_class": per_class, "train": splits.get("train", 0),
            "val": splits.get("val", 0)}


def legacy_datasets(ctx: StepContext) -> dict:
    """Step 5: register each materialised project dataset in the library as a legacy dataset, so it
    stays trainable from Models (spec §6.1, §11.4). The folder is found under the original project
    folder (`origin_folder`), never copied or moved. Keyed by `legacy_path`, so a re-run adds nothing."""
    library = ports.require_library(ctx.env.library)
    s = ctx.session
    project = ctx.handle.row(s)
    id_map = dict(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all())
    rows = s.execute(text(
        "SELECT id, name, classes, split_method, split_params, path FROM dataset ORDER BY created_at, id"
    )).mappings().all()
    names, already, warnings = [], 0, []
    with STORE_LOCK, library.session() as ls:
        for d in rows:
            root = (ctx.env.origin_folder / d["path"]).resolve()
            if not (root / "data.yaml").is_file():
                warnings.append(f"dataset {d['name']} was never built on disk ({d['path']}); "
                                "it is not carried into Models")
                continue
            if ports.legacy_dataset_by_path(ls, str(root)) is not None:
                already += 1
                continue
            classes = [{"type_id": c["id"], "name": c["name"]} for c in json.loads(d["classes"] or "[]")]
            counts = _dataset_counts(s, d["id"], id_map)
            name = ports.unique_dataset_name(ls, f"{d['name']} ({project.name})")
            dataset_id = ports.insert_legacy_dataset(
                ls, name=name, classes=classes, split_method=d["split_method"],
                split_params=json.loads(d["split_params"] or "{}"), counts=counts, legacy_path=str(root),
                filter={"project_ids": [ctx.handle.id], "type_ids": [c["type_id"] for c in classes],
                        "captured_from": None, "captured_to": None, "reviewed_only": True},
            )
            ports.insert_dataset_source(ls, dataset_id=dataset_id, project_id=ctx.handle.id,
                                        project_folder=str(ctx.env.origin_folder), project_name=project.name,
                                        image_count=counts["images"])
            ls.flush()
            names.append(name)
    return {"registered": len(names), "names": names, "already_registered": already, "warnings": warnings}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_step_datasets.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/steps.py backend/tests/test_migration_step_datasets.py
git commit -m "feat(migration): step 5 registers materialised project datasets as legacy library datasets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Steps 6 and 7, `findings_from_annotations` and `counts_rebuild`

**Files:**
- Modify: `backend/app/migration/steps.py`
- Test: `backend/tests/test_migration_step_findings.py`

**Interfaces:**
- Consumes: `project_type` (step 3); BC's `app.findings.backfill.findings_from_annotations(handle, type_ids=None, *, batch=1000, progress=None, check_cancelled=None) -> int` (the one box → finding implementation, spec §7.2 and §11.4; it reads `handle.catalogue`); `ports.rebuild_counts`, `add_activity_once`.
- Produces:
  - `steps.FINDING_BATCH = 1000`
  - `steps.findings_from_annotations(ctx) -> {"findings_created": int}` (step 6: a thin call of BC's function with `type_ids=None`)
  - `steps.counts_rebuild(ctx) -> {"findings": int}`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_step_findings.py`:

```python
"""Step 6 (accepted defect boxes become reviewed findings) and step 7 (counts), spec §11.4, D6, F4."""

import pytest
from migration_helpers import (
    add_images_and_boxes,
    at_revision,
    env_for,
    open_handle,
    open_stores,
    run_step,
)
from sqlalchemy import text

from app.findings.backfill import findings_from_annotations as create_findings
from app.migration import ports, steps

CRACK = [{"id": "c-crack", "name": "crack", "colour": "#ef4444", "hotkey": None, "order": 0}]
UP_TO_TYPES = (steps.catalogue_merge, steps.rewrite_class_ids, steps.project_types)


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _defect_type(stores, name="Crack") -> str:
    with stores.catalogue.session() as cs:
        type_id = ports.create_type(cs, name=name, colour="#ef4444", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET kind = 'defect' WHERE id = :id"), {"id": type_id})
    return type_id


def _project(tmp_path, stores, classes):
    folder = at_revision(tmp_path / "p", "0009", classes=classes)
    add_images_and_boxes(folder, classes=classes)
    h = open_handle(folder)
    env = env_for(stores, folder)
    for fn in UP_TO_TYPES:
        run_step(h, env, fn)
    return h, env


def _findings(h):
    with h.session() as s:
        return [dict(r) for r in s.execute(text(
            "SELECT number, annotation_id, status, severity, created_by, lon, lat, data_type, data_id, type_id"
            " FROM finding ORDER BY number"
        )).mappings()]


def test_object_types_create_no_findings(tmp_path, stores):
    h, env = _project(tmp_path, stores, [{"id": "c-exc", "name": "excavator", "colour": "#f97316", "hotkey": None,
                                          "order": 0}])
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 0}
    assert _findings(h) == []


def test_accepted_edited_and_person_boxes_on_defect_types_become_numbered_findings(tmp_path, stores):
    crack = _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 3}
    found = _findings(h)
    assert [(f["number"], f["annotation_id"], f["status"], f["severity"], f["created_by"]) for f in found] == [
        (1, "b-c-crack-0", "reviewed", None, "model:m-old"),
        (2, "b-c-crack-1", "reviewed", None, "model:m-old"),
        (3, "b-c-crack-2", "reviewed", None, "human"),
    ]
    assert [(f["lon"], f["lat"]) for f in found] == [(55.2, 25.1), (None, None), (55.2, 25.1)]
    assert {(f["data_type"], f["data_id"], f["type_id"]) for f in found} == {("image_set", "s1", crack)}


def test_batches_commit_as_they_go_and_a_rerun_creates_none(tmp_path, stores):
    crack = _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    h.catalogue = stores.catalogue  # BC's function reads the catalogue through the handle
    progress = []
    created = create_findings(h, [crack], batch=2, progress=lambda done, total: progress.append(done))
    assert created == 3 and progress == [2, 3]
    assert create_findings(h, [crack], batch=2) == 0
    assert run_step(h, env, steps.findings_from_annotations) == {"findings_created": 0}
    assert [f["number"] for f in _findings(h)] == [1, 2, 3]


def test_counts_are_rebuilt_and_the_upgrade_is_logged_once(tmp_path, stores):
    _defect_type(stores)
    h, env = _project(tmp_path, stores, CRACK)
    run_step(h, env, steps.findings_from_annotations)
    assert run_step(h, env, steps.counts_rebuild) == {"findings": 3}
    run_step(h, env, steps.counts_rebuild)
    with h.session() as s:
        assert s.execute(text("SELECT SUM(n) FROM finding_count WHERE status = 'reviewed'")).scalar_one() == 3
        logged = s.execute(text("SELECT COUNT(*) FROM activity WHERE summary = 'Project upgraded'")).scalar_one()
    assert logged == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_step_findings.py -v`
Expected: FAIL with `AttributeError: module 'app.migration.steps' has no attribute 'findings_from_annotations'`.

- [ ] **Step 3: Implement steps 6 and 7**

Add to `backend/app/migration/steps.py` above `PIPELINE`:

```python
FINDING_BATCH = 1000


def findings_from_annotations(ctx: StepContext) -> dict:
    """Step 6: findings from accepted boxes on the project's **defect** types, through BC's one
    implementation (`app.findings.backfill.findings_from_annotations`, spec §7.2 and §11.4): batched,
    one transaction per batch, idempotent on `annotation_id`, so a resumed step creates none twice.
    With F4 every migrated type is an `object`, so this is normally empty; the Catalogue's backfill
    runs the same function later for a type the operator marks as a defect."""
    from app.findings.backfill import findings_from_annotations as create_findings

    if getattr(ctx.handle, "catalogue", None) is None:
        ctx.handle.catalogue = ctx.env.catalogue  # BC's function reads the catalogue through the handle
    created = create_findings(
        ctx.handle,
        None,
        batch=FINDING_BATCH,
        check_cancelled=ctx.env.check_cancelled,
        progress=lambda done, total: ctx.env.progress(0.8, f"Created {done} of {total} findings from accepted annotations"),
    )
    return {"findings_created": created}


def counts_rebuild(ctx: StepContext) -> dict:
    """Step 7: rebuild `finding_count` and `finding_daily` from `finding` (the counts module is
    their only writer), and log "Project upgraded" once in the activity feed."""
    s = ctx.session
    ports.rebuild_counts(s)
    total = int(s.execute(text("SELECT COUNT(*) FROM finding")).scalar_one())
    ports.add_activity_once(s, kind="job.finished", subject_id=ctx.handle.id, summary="Project upgraded",
                            payload={"job_type": "project_migrate", "findings": total})
    return {"findings": total}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_step_findings.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/migration/steps.py backend/tests/test_migration_step_findings.py
git commit -m "feat(migration): steps 6 and 7 turn accepted defect boxes into findings and rebuild counts" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Arm the pipeline

**Files:**
- Modify:
  - `backend/app/migration/steps.py` (`PIPELINE`)
  - `backend/app/migration/job.py` (`blocked_reason`)
  - `backend/app/projects/service.py` (`create`)
  - `backend/app/main.py` (only to order the `submit_pending` block after BC's `open_catalogue`; BC wires `runner.catalogue`)
  - `backend/scripts/migration_dry_run.py` (`open_stores`)
- Create: `backend/app/migration/banners.py` (the Overview's migration-warning banner, appended to BC's `overview.service.BANNER_PROVIDERS`; spec §9.1 "Banners: migration warnings (§11)")
- Test: `backend/tests/test_migration_end_to_end.py`, `backend/tests/test_migration_banners.py`

**Interfaces:**
- Consumes: steps 1–7 (Tasks 10–14); Part A's orchestration; BC's `app.state.catalogue`.
- Produces:
  - `steps.PIPELINE`: the seven steps in spec order
  - `job.WAITING_FOR_CATALOGUE`, and `blocked_reason` returns it when armed with no catalogue
  - `ProjectRegistry.create` writes `schema_version = 2` (`TARGET_SCHEMA_VERSION`)
  - (verified, not written here) `runner.catalogue` is set in `lifespan` by BC
  - `migration_dry_run.open_stores` returns `(library, catalogue)`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_end_to_end.py`:

```python
"""The armed migration end to end (foundation spec §16 "Migration", §17.7, D6, F4)."""

import json

import pytest
from fastapi.testclient import TestClient
from migration_helpers import (
    AUTH,
    add_cloud_rows,
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    at_revision,
    catalogue_types,
    env_for,
    needs_classification,
    open_handle,
    open_stores,
    revision_of,
    run_step,
    wait_library_job,
)
from sqlalchemy import text

from app.appdata import AppData
from app.migration import ports, steps
from app.migration.backup import latest_backup
from app.migration.invariants import compare, snapshot
from app.migration.pipeline import Step, StepFailed, run_pipeline
from app.migration.state import MigrationStates

NORTH = [{"id": "a-exc", "name": "excavator", "colour": "#f97316", "hotkey": "1", "order": 0},
         {"id": "a-dump", "name": "dump_truck", "colour": "#06b6d4", "hotkey": "2", "order": 1}]
SOUTH = [{"id": "b-dump", "name": "Dump truck", "colour": "#ff0000", "hotkey": "3", "order": 0},
         {"id": "b-crane", "name": "crane", "colour": "#3b82f6", "hotkey": "2", "order": 1}]


def _north_and_south(tmp_path):
    a = at_revision(tmp_path / "north", "0009", pid="pa", name="North", classes=NORTH)
    add_images_and_boxes(a, classes=NORTH)
    add_detect_rows(a, classes=NORTH)
    add_cloud_rows(a)
    add_dataset(a, classes=NORTH)
    b = at_revision(tmp_path / "south", "0009", pid="pb", name="South", classes=SOUTH)
    add_images_and_boxes(b, classes=SOUTH)
    return a, b


def _remember(settings, *entries):
    recent = AppData(settings.data_dir)
    for pid, name, folder in entries:
        recent.remember(pid, name, str(folder))


def _wait_all(c, settings, *folders):
    states = MigrationStates(settings.data_dir)
    for folder in folders:
        assert wait_library_job(c, states.get(folder)["job_id"])["state"] == "succeeded", folder
        assert states.get(folder)["state"] == "ok"


def _type_ids(handle):
    with handle.session() as s:
        return list(s.execute(text("SELECT type_id FROM project_type ORDER BY position")).scalars())


def test_two_projects_upgrade_at_startup_into_one_catalogue(app, settings, tmp_path):
    a, b = _north_and_south(tmp_path)
    before = {f: snapshot(f / "project.db") for f in (a, b)}
    _remember(settings, ("pb", "South", b), ("pa", "North", a))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, a, b)
        for pid in ("pa", "pb"):
            assert c.get(f"/api/v1/projects/{pid}").status_code == 200
        types = catalogue_types(app.state.catalogue)
        assert set(types) == {"excavator", "dump_truck", "crane"}
        assert all(t["kind"] == "object" and t["origin"] == "migrated" for t in types.values())
        assert needs_classification(app.state.catalogue)
        ha, hb = app.state.projects.get("pa"), app.state.projects.get("pb")
        assert _type_ids(ha) == [types["excavator"]["id"], types["dump_truck"]["id"]]
        assert _type_ids(hb) == [types["dump_truck"]["id"], types["crane"]["id"]]
        with hb.session() as s:
            assert set(s.execute(text("SELECT DISTINCT class_id FROM box")).scalars()) == set(_type_ids(hb))
        for folder in (a, b):
            report = json.loads((folder / "backups" / "migration-v2.json").read_text("utf-8"))
            assert [s["name"] for s in report["steps"]] == [s.name for s in steps.PIPELINE]
            assert revision_of(latest_backup(folder)) == "0009"
    for folder in (a, b):
        assert compare(before[folder], snapshot(folder / "project.db")) == []


def test_a_pre_0007_training_project_upgrades_and_keeps_its_dataset(app, settings, tmp_path):
    folder = at_revision(tmp_path / "train", "0006", pid="pt", name="Train")
    add_images_and_boxes(folder)
    add_dataset(folder)
    _remember(settings, ("pt", "Train", folder))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, folder)
        with app.state.library.session() as ls:
            rows = ls.execute(text("SELECT name, legacy_path FROM dataset WHERE origin = 'legacy'")).all()
    assert [tuple(r) for r in rows] == [("v1 (Train)", str((folder / "datasets" / "v1").resolve()))]
    assert revision_of(latest_backup(folder)) == "0006"


def test_a_type_already_marked_defect_gets_numbered_findings(app, settings, tmp_path):
    catalogue = ports.open_catalogue_db(settings.data_dir)
    with catalogue.session() as cs:
        crack = ports.create_type(cs, name="Crack", colour="#ef4444", hotkey=None)
        cs.execute(text("UPDATE catalogue_type SET kind = 'defect' WHERE id = :id"), {"id": crack})
    catalogue.engine.dispose()
    classes = [{"id": "c-crack", "name": "crack", "colour": "#ef4444", "hotkey": None, "order": 0}]
    folder = at_revision(tmp_path / "bridge", "0009", pid="pbr", name="Bridge", classes=classes)
    add_images_and_boxes(folder, classes=classes)
    _remember(settings, ("pbr", "Bridge", folder))
    with TestClient(app, headers=AUTH) as c:
        _wait_all(c, settings, folder)
        with app.state.projects.get("pbr").session() as s:
            numbers = list(s.execute(text("SELECT number FROM finding ORDER BY number")).scalars())
            total = s.execute(text("SELECT SUM(n) FROM finding_count")).scalar_one()
    assert numbers == [1, 2, 3] and total == 3


def test_a_new_project_is_born_upgraded(app, client, tmp_path):
    r = client.post("/api/v1/projects", json={"name": "New", "folder": str(tmp_path / "new"), "type_ids": []})
    assert r.status_code == 201, r.text
    assert r.json()["schema_version"] == 2 and r.json()["migration"]["state"] == "ok"
    assert MigrationStates(app.state.settings.data_dir).get(tmp_path / "new") is None
    assert client.get(f"/api/v1/projects/{r.json()['id']}").status_code == 200


def test_without_the_catalogue_a_legacy_project_waits(app, client, tmp_path, monkeypatch):
    folder = at_revision(tmp_path / "old", "0009")
    monkeypatch.setattr(app.state.jobs, "catalogue", None)
    r = client.post("/api/v1/projects/open", json={"folder": str(folder)})
    assert r.json()["migration"]["state"] == "pending" and "catalogue" in r.json()["migration"]["error"]
    g = client.get(f"/api/v1/projects/{r.json()['id']}")
    assert g.status_code == 409 and g.json()["error"]["details"] == {"job_id": None}


@pytest.fixture
def stores(tmp_path):
    st = open_stores(tmp_path / "appdata")
    yield st
    st.close()


def _state(handle, stores) -> dict:
    """Everything the steps write, without timestamps: equal states mean nothing was written twice."""
    with handle.session() as s:
        project = {
            "boxes": sorted(s.execute(text("SELECT id, class_id FROM box")).all()),
            "map": s.execute(text("SELECT counts, area_counts, class_map FROM map_run")).all(),
            "ids": sorted(s.execute(text("SELECT old_class_id, type_id FROM class_id_map")).all()),
            "types": s.execute(text("SELECT type_id, position, hotkey_override FROM project_type ORDER BY position")).all(),
            "findings": s.execute(text("SELECT number, annotation_id FROM finding ORDER BY number")).all(),
            "activity": s.execute(text("SELECT COUNT(*) FROM activity")).scalar_one(),
        }
    with stores.catalogue.session() as cs:
        project["catalogue"] = sorted(cs.execute(text("SELECT id, name, kind FROM catalogue_type")).all())
    with stores.library.session() as ls:
        project["datasets"] = sorted(ls.execute(text("SELECT name, legacy_path FROM dataset")).all())
    return project


def test_every_step_is_idempotent(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    add_dataset(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)
    run_pipeline(h, env, steps.PIPELINE)
    after_once = _state(h, stores)
    for step in steps.PIPELINE:
        run_step(h, env, step.run)
    assert _state(h, stores) == after_once


def test_a_crash_between_steps_resumes_without_duplicates(tmp_path, stores):
    folder = at_revision(tmp_path / "p", "0009")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    h = open_handle(folder)
    env = env_for(stores, folder)

    def crash(ctx):
        raise RuntimeError("the sidecar was killed")

    broken = tuple(Step(s.name, s.label, crash) if s.name == "project_types" else s for s in steps.PIPELINE)
    with pytest.raises(StepFailed) as err:
        run_pipeline(h, env, broken)
    assert err.value.step == "project_types"
    run_pipeline(h, env, steps.PIPELINE)
    assert len(catalogue_types(stores)) == 2
    assert len(_state(h, stores)["ids"]) == 2 and len(_state(h, stores)["types"]) == 2
    with h.session() as s:
        assert s.execute(text("SELECT schema_version FROM project")).scalar_one() == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_end_to_end.py -v`
Expected: FAIL. The startup tests time out or assert on `None` (disarmed, nothing is queued). `test_every_step_is_idempotent` runs an empty pipeline, so `_state` differs from a migrated project and the later assertions fail. `test_a_new_project_is_born_upgraded` gets `schema_version == 1`.

- [ ] **Step 3: Arm**

1. At the end of `backend/app/migration/steps.py`, replace `PIPELINE: tuple[Step, ...] = ()` with:
   ```python
   PIPELINE: tuple[Step, ...] = (
       Step("catalogue_merge", "Merging the project's classes into the catalogue", catalogue_merge),
       Step("rewrite_class_ids", "Pointing annotations and detections at catalogue types", rewrite_class_ids),
       Step("project_types", "Building the project's type list", project_types),
       Step("library_class_maps", "Moving model class mappings into the library", library_class_maps),
       Step("legacy_datasets", "Registering the project's datasets in Models", legacy_datasets),
       Step("findings_from_annotations", "Creating findings from accepted defect annotations",
            findings_from_annotations),
       Step("counts_rebuild", "Counting findings", counts_rebuild),
   )
   ```
   Change the module docstring's last paragraph to: "`PIPELINE` is armed: every project below schema version 2 runs it (ADR 2026-09-26-migration-framework-ships-disarmed)."
2. In `backend/app/migration/job.py`, add `WAITING_FOR_CATALOGUE = "Waiting for the catalogue: this project opens once the catalogue is available."`. `blocked_reason` becomes:
   ```python
   def blocked_reason(runner) -> str | None:
       """Why no upgrade job can run right now, or None (foundation spec §15)."""
       if getattr(runner, "library", None) is None:
           return WAITING_FOR_LIBRARY
       if armed() and getattr(runner, "catalogue", None) is None:
           return WAITING_FOR_CATALOGUE
       return None
   ```
3. In `backend/app/projects/service.py`, `ProjectRegistry.create`: add `from app.migration.pipeline import TARGET_SCHEMA_VERSION` to the imports, add `schema_version=TARGET_SCHEMA_VERSION` to the `Project(...)` constructor, and pass `schema_version=TARGET_SCHEMA_VERSION` to `self._cache(...)`. A new project has no legacy classes, so it is born upgraded. Leave BC's `project_type` writing in `create` as it is.
4. In `backend/app/main.py`, BC already sets `app.state.jobs.catalogue = app.state.catalogue` (BC Task 1); do not add a second assignment. Confirm that the `migration_startup.submit_pending(app)` block from Task 6 comes **after** `open_catalogue`. If BC put `open_catalogue` later in `lifespan`, move the block below it.
5. In `backend/scripts/migration_dry_run.py`, `open_stores` becomes:
   ```python
   def open_stores(appdata: Path):
       """The library and the catalogue, opened on the copies."""
       from app.library.handle import open_library
       from app.migration import ports

       return open_library(appdata), ports.open_catalogue_db(appdata)
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_end_to_end.py -v`
Expected: 7 passed.

- [ ] **Step 4b: The migration-warning banner on the Overview**

BC's Overview endpoint collects banners from `app.overview.service.BANNER_PROVIDERS` (BC Task 13;
each provider takes the `ProjectHandle` and returns C0's `OverviewBanner` dicts
`{kind, tone, message, action?}`). MG adds the `migration_warning` kind. It reads only the project's
small report file, so the Overview stays a bounded read.

Create `backend/tests/test_migration_banners.py`:

```python
"""The Overview's migration-warning banner (foundation spec §9.1, §11.4 report)."""

import json
from types import SimpleNamespace

from app.migration import banners
from app.overview import service as overview_service


def _handle(tmp_path, report=None):
    if report is not None:
        (tmp_path / "backups").mkdir()
        (tmp_path / "backups" / "migration-v2.json").write_text(json.dumps(report), "utf-8")
    return SimpleNamespace(folder=tmp_path)


def test_no_report_or_no_warnings_means_no_banner(tmp_path):
    assert banners.migration_banners(_handle(tmp_path)) == []
    assert banners.migration_banners(_handle(tmp_path, {"warnings": []})) == []


def test_warnings_become_one_warn_banner(tmp_path):
    [b] = banners.migration_banners(_handle(tmp_path, {"warnings": ["a", "b"]}))
    assert b == {
        "kind": "migration_warning",
        "tone": "warn",
        "message": "The upgrade finished with 2 notes. They are listed in backups/migration-v2.json in the project folder.",
        "action": None,
    }


def test_an_unreadable_report_is_ignored(tmp_path):
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / "migration-v2.json").write_text("{not json", "utf-8")
    assert banners.migration_banners(SimpleNamespace(folder=tmp_path)) == []


def test_it_is_registered_once():
    banners.register()
    banners.register()
    assert overview_service.BANNER_PROVIDERS.count(banners.migration_banners) == 1
```

Create `backend/app/migration/banners.py`:

```python
"""The Overview banner for an upgrade that left notes (foundation spec §9.1, §11.4)."""

import json
from pathlib import Path

from app.migration.pipeline import REPORT_NAME


def migration_banners(handle) -> list[dict]:
    try:
        report = json.loads((Path(handle.folder) / "backups" / REPORT_NAME).read_text("utf-8"))
    except (OSError, ValueError):
        return []
    n = len(report.get("warnings") or []) if isinstance(report, dict) else 0
    if not n:
        return []
    notes = "1 note" if n == 1 else f"{n} notes"
    return [
        {
            "kind": "migration_warning",
            "tone": "warn",
            "message": f"The upgrade finished with {notes}. They are listed in backups/{REPORT_NAME} in the project folder.",
            "action": None,
        }
    ]


def register() -> None:
    from app.overview.service import BANNER_PROVIDERS

    if migration_banners not in BANNER_PROVIDERS:
        BANNER_PROVIDERS.append(migration_banners)
```

In `backend/app/main.py` `lifespan`, next to the `submit_pending` block: `from app.migration import banners` and
`banners.register()`.

Run: `& $PY -m pytest tests/test_migration_banners.py tests/test_overview.py -v`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite and fix the fallout**

Run: `& $PY -m pytest -q`
Expected: all pass. Armed, any test that opens a version-1 project through the registry now meets the gate. Fix each failure as follows:
- A Part A test that did not pin its pipeline: add `arm(monkeypatch)` (disarmed) or its own steps.
- A test outside `test_migration_*` that builds a project at an old revision and then calls an API route on it (for example in `test_library_adoption.py`): set `schema_version = 2` in its builder with `migration_helpers.set_schema_version`. Or, when the test is about opening old projects, wait for the upgrade job with `wait_library_job`.

Do not loosen the gate itself.

- [ ] **Step 6: Commit**

Stage every file you changed by path. For example:
```powershell
git add backend/app/migration/steps.py backend/app/migration/job.py backend/app/migration/banners.py backend/app/projects/service.py backend/app/main.py backend/scripts/migration_dry_run.py backend/tests/test_migration_end_to_end.py backend/tests/test_migration_banners.py
git status --short
git commit -m "feat(migration): arm the pipeline; new projects are born upgraded; wait for the catalogue" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Add any test files you fixed in Step 5 to the `git add` line, and name them in the commit body.

---

### Task 16: The real-folder dry run (the merge gate), evidence and merge

**Files:**
- Modify: `backend/scripts/migration_dry_run.py` (`project_checks`, `summarise_stores`), `backend/tests/test_migration_dry_run.py`, `backend/tests/test_migration_real.py`
- Create: `docs/evidence/foundation-migration/dry-run.json`, `dry-run.txt`, `broken-run.txt`, `README.md`
- Modify: `docs/progress.md`

**Interfaces:**
- Consumes: Tasks 1–15.
- Produces:
  - `project_checks(handle) -> {"project_types": int, "unmapped_boxes": int, "findings": int}`
  - `summarise_stores(library, catalogue) -> {"catalogue_types": [{name, kind, origin, hotkey}], "needs_classification": bool, "legacy_datasets": [{name, legacy_path}]}`
  - The evidence the merge is gated on.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_migration_dry_run.py`:

```python
def test_the_armed_dry_run_reports_what_the_gate_reads(mod, real_like, tmp_path):
    data_dir, old, busy = real_like
    report = mod.dry_run([busy, old], data_dir, tmp_path / "work")
    assert report["ok"] and report["armed"], report
    by_name = {Path(p["folder"]).name: p for p in report["projects"]}
    assert by_name["busy"]["checks"] == {"project_types": 2, "unmapped_boxes": 0, "findings": 0}
    assert by_name["busy"]["schema_version_after"] == 2
    stores = report["stores"]
    assert sorted(t["name"] for t in stores["catalogue_types"]) == ["dump_truck", "excavator"]
    assert all(t["kind"] == "object" for t in stores["catalogue_types"]) and stores["needs_classification"]
    assert [d["name"] for d in stores["legacy_datasets"]] == ["v1 (Busy)"]
```

In `backend/tests/test_migration_real.py`, add at the end of the test:

```python
    assert report["armed"], "the steps are not wired: this run proves nothing"
    assert all(p["checks"].get("unmapped_boxes") == 0 for p in report["projects"]), report["projects"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `& $PY -m pytest tests/test_migration_dry_run.py -v`
Expected: `test_the_armed_dry_run_reports_what_the_gate_reads` FAILS with `assert {} == {'project_types': 2, …}`.

- [ ] **Step 3: Fill in the two hooks**

In `backend/scripts/migration_dry_run.py`, add `from sqlalchemy import text` next to the `select` import. Replace the two stubs:

```python
def project_checks(handle) -> dict:
    """Per-project facts the merge gate reads: the type list, boxes whose class is no project type
    (must be 0 on real data, or explained), and findings created (0 under F4)."""
    with handle.session() as s:
        return {
            "project_types": s.execute(text("SELECT COUNT(*) FROM project_type")).scalar_one(),
            "unmapped_boxes": s.execute(text(
                "SELECT COUNT(*) FROM box WHERE class_id NOT IN (SELECT type_id FROM project_type)"
            )).scalar_one(),
            "findings": s.execute(text("SELECT COUNT(*) FROM finding")).scalar_one(),
        }


def summarise_stores(library, catalogue) -> dict:
    """App-wide facts the merge gate reads: the merged catalogue and the legacy datasets."""
    out: dict = {}
    if catalogue is not None:
        with catalogue.session() as cs:
            out["catalogue_types"] = [dict(r) for r in cs.execute(text(
                "SELECT name, kind, origin, hotkey FROM catalogue_type ORDER BY name"
            )).mappings()]
            out["needs_classification"] = cs.execute(text(
                "SELECT 1 FROM catalogue_meta WHERE key = 'needs_classification'"
            )).first() is not None
    with library.session() as ls:
        out["legacy_datasets"] = [dict(r) for r in ls.execute(text(
            "SELECT name, legacy_path FROM dataset WHERE origin = 'legacy' ORDER BY name"
        )).mappings()]
    return out
```

`dry_run_one` already calls `project_checks` only when the pipeline is armed (Task 4), so its tables (`project_type`, `finding`, from `0010` on) always exist when it runs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_dry_run.py tests/test_migration_real.py -v`
Expected: all pass, and the real test is skipped.

- [ ] **Step 5: Commit**

```powershell
git add backend/scripts/migration_dry_run.py backend/tests/test_migration_dry_run.py backend/tests/test_migration_real.py
git commit -m "feat(migration): the dry run reports the facts the merge gate reads" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Take stock of the real folders (read only)**

Close Kestrel AI first. Then, from `E:\Dev\Yolo\app\.claude\worktrees\f-mg-steps\backend`:
```powershell
Get-Process | Where-Object { $_.ProcessName -match "kestrel" }
Get-Content "$env:APPDATA\ai.synapse-solutions.kestrel-ai\recent_projects.json"
Get-ChildItem E:\Projects -Depth 2 -Filter project.db | Select-Object FullName, Length, LastWriteTime
Test-Path "$env:TEMP\acceptance-project\project.db"
```
Expected: no Kestrel process. The recent list names `E:\Projects\AHTest`. `E:\Projects` holds `AHTest\project.db` and `Ahmadia\project.db`, and the acceptance project exists. At planning time (2026-09-26) these folders held:

| Folder | Revision | Classes | Boxes | Project datasets |
| --- | --- | --- | --- | --- |
| `E:\Projects\AHTest` (recent) | `0009` | 7: excavator, bulldozer, dump_truck, crane, concrete_mixer, roller, backhoe (hotkeys 1–7) | 11,951 | 4 materialised: `Initial_Construction_Vehicle_Detection`, `ICVD_V2`, `ICVD_V3`, `ICVD_V4` |
| `E:\Projects\Ahmadia` | `0001` | 1: excavator | 0 | none |
| `%TEMP%\acceptance-project` (the 2026-09-20 acceptance run) | `0002` | 8: the seven above plus wheel_loader (its hotkeys shifted: wheel_loader 2, bulldozer 3, …) | 108,327 | `v1`, **not** materialised |

If Step 6 finds another folder with a `project.db`, add it to `--folders`. A project folder the operator uses is real data, whether or not it is in the recent list.

- [ ] **Step 7: Run the dry run over every real folder**

```powershell
& $PY scripts\migration_dry_run.py --recent --folders E:\Projects\Ahmadia "$env:TEMP\acceptance-project" --out ..\docs\evidence\foundation-migration\dry-run.json | Tee-Object ..\docs\evidence\foundation-migration\dry-run.txt
$LASTEXITCODE
```

**Pass criteria.** Every one must hold. Read them from `dry-run.json`.
1. Exit code `0`, `"ok": true`, `"armed": true`, and three projects in the order AHTest, Ahmadia, acceptance-project.
2. For each project:
   - `ok: true` and `error: null`
   - `revision_after` equals `head`, and `schema_version_after` is `2`
   - `backup_expected: true`, and `backup.quick_check` is `"ok"`
3. For each project, `mismatches: []`. Row counts are unchanged in every table (`box` stays 11,951, 0 and 108,327), and every `counts`/`verified_counts`/`area_counts` total is unchanged.
4. For each project, `originals_unchanged: true`. The originals' `project.db`, `-wal` and `-shm` hashes are identical before and after.
5. `checks.project_types` is **7** for AHTest, **1** for Ahmadia and **8** for acceptance. `checks.unmapped_boxes` is **0** for all three, and `checks.findings` is **0** for all three (F4: every migrated type is an object).
6. `stores.catalogue_types` holds exactly **8** types, all `kind: object` and `origin: migrated`: backhoe, bulldozer, concrete_mixer, crane, dump_truck, excavator, roller, wheel_loader. The hotkeys are AHTest's (excavator 1, bulldozer 2, dump_truck 3, crane 4, concrete_mixer 5, roller 6, backhoe 7), and wheel_loader has none. `stores.needs_classification` is `true`.
7. `stores.legacy_datasets` holds exactly **4** datasets, `"<name> (Ahmadia)"` for the four ICVD/Initial datasets, each with a `legacy_path` under `E:\Projects\AHTest\datasets\`. Acceptance's `v1` appears only as a warning ("never built on disk").
8. Every warning is one of the expected kinds (a hotkey kept from the catalogue, a dataset never built, a model missing from the library). Any other warning is investigated and explained in `README.md` before merging.
9. Each project's `seconds` is recorded. Acceptance (108k boxes) is expected to finish in well under a minute. Above 300 s, stop and investigate: it is not a failure of this gate, but the first-start upgrade would then be slow for the operator.

If a criterion fails, fix the code (with a test that reproduces it on a fixture) and rerun Step 7. Never edit the evidence.

- [ ] **Step 8: Prove skip-and-flag on a broken folder**

```powershell
$broken = Join-Path $env:TEMP "mg-broken-project"
New-Item -ItemType Directory -Force $broken | Out-Null
Set-Content -Path (Join-Path $broken "project.db") -Value ("not a database" * 100) -Encoding ascii
& $PY scripts\migration_dry_run.py --folders E:\Projects\AHTest $broken | Tee-Object ..\docs\evidence\foundation-migration\broken-run.txt
$LASTEXITCODE
```
Expected: exit code `1`. `[ok]` is printed for AHTest and `[FAILED]` with an error for the broken folder, and the run ends `FAIL`. One broken project does not stop the others (spec §17.7).

- [ ] **Step 9: The opt-in pytest over the real folders**

```powershell
$env:KESTREL_REAL_PROJECTS = "E:\Projects\AHTest;E:\Projects\Ahmadia;$env:TEMP\acceptance-project"
& $PY -m pytest tests/test_migration_real.py -v -m real_data
Remove-Item Env:KESTREL_REAL_PROJECTS
```
Expected: 1 passed.

- [ ] **Step 10: Write the evidence README and the ledger entry**

Create `docs/evidence/foundation-migration/README.md` with:
- the date
- the commit
- the three input folders and their revisions
- the exact commands of Steps 7–9
- each pass criterion with the value read from `dry-run.json`
- the warnings and their explanations
- the durations

Add a `docs/progress.md` entry in the file's existing style, "Foundation MG: real-folder dry run", with the same facts in three to five lines and a link to the evidence folder.

- [ ] **Step 11: Rebase and run the whole gate**

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-mg-steps
git fetch . main:main 2>$null; git rebase main
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
if (Test-Path frontend\src-tauri\binaries\kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```
Expected: every step passes. If the rebase brought new commits, rerun Step 7 on the rebased code before merging. The evidence must match the code that merges.

- [ ] **Step 12: Commit the evidence**

```powershell
git add docs/evidence/foundation-migration/dry-run.json docs/evidence/foundation-migration/dry-run.txt docs/evidence/foundation-migration/broken-run.txt docs/evidence/foundation-migration/README.md docs/progress.md
git commit -m "docs(evidence): the foundation migration dry run over every real project" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 13: Merge in the slot**

When the coordinator gives MG-steps its slot in batch 3, run `scripts\finish-task.ps1` from the worktree. Never pass `-SkipGate`. After the merge, the next build of `main` that the operator starts upgrades their real projects on first start, each with a backup.

- [ ] **Step 14: Operator walkthrough (post with the merge)**

This walkthrough runs on a **copy**, so the real projects are upgraded only when the operator next starts the app for real.
1. Make a scratch app-data folder with one small project:
   ```powershell
   $w = Join-Path $env:TEMP "mg-walk"; New-Item -ItemType Directory -Force "$w\appdata" | Out-Null
   Copy-Item E:\Projects\Ahmadia "$w\Ahmadia" -Recurse
   '[{"id":"walk","name":"Ahmadia","folder":"' + ("$w\Ahmadia" -replace '\\','\\') + '"}]' | Set-Content "$w\appdata\recent_projects.json"
   ```
2. Start the backend on it: `cd backend; $env:APP_TOKEN="walk"; $env:APP_PORT="8799"; $env:APP_DATA_DIR="$w\appdata"; & $PY -m app`.
3. In a second PowerShell, run `Invoke-RestMethod http://127.0.0.1:8799/api/v1/projects -Headers @{Authorization="Bearer walk"} | ConvertTo-Json -Depth 5`. The project's `migration.state` is `running` and then, on the next call, `ok`.
4. `Get-ChildItem "$w\Ahmadia\backups"` shows `project.db.v1-<stamp>.bak` and `migration-v2.json`.
5. `Invoke-RestMethod http://127.0.0.1:8799/api/v1/catalogue/types -Headers @{Authorization="Bearer walk"}` lists `excavator` as a migrated object type. The Catalogue screen with its "Mark which are defects" banner arrives with S2.
6. Stop the backend (Ctrl C) and delete `$w`.

- [ ] **Step 15: Report to the coordinator**

Send:
- the merged commit range
- the reconciled names (Task 9)
- the backfill decision (Task 9 Step 3)
- the evidence folder
- the pass-criteria table with the real values
- resolved ambiguities 11–18
- ambiguity 8 (deleted folders), resolved by the operator on 2026-09-26: listed as missing

---

## Spec coverage (self-review)

| Spec item | Task |
| --- | --- |
| §11.1 revisions: MG writes none, and consumes `0010`/`0002`/`0001` | Global Constraints, Task 9 guard |
| §11.2 backup: current revision, WAL checkpoint, backup API, quick_check, `BackupFailed`, untouched DB, backups kept | Task 1; flagged by the registry in Task 5 |
| §11.3 `migrations.json` | Task 2 |
| §11.3 startup submission to the library runner, nothing blocks startup | Task 6 |
| §11.3 `ProjectRegistry.open` submits below version 2 | Task 6 (`ensure_submitted` on open) |
| §11.3 `get_project` 409s | Task 6 |
| §11.3 Retry | Task 7 |
| §11.3 restore by hand only | Task 7 docstring; nothing restores |
| §11.4 ledger, skip if recorded, one transaction per step | Task 3 |
| §11.4 steps 1–7 | Tasks 10–14 |
| §11.4 step 8 `finish` and report | Task 3 (`finish`), armed in Task 15 |
| §11.4 "maps, clouds, surfaces, volumes, runs untouched beyond step 2" | Task 15 (`add_cloud_rows` plus invariants) |
| §11.5 dry-run script: copies, never writes originals, stub runner, prints, exits non-zero | Task 4 |
| §11.5 `test_migration_real.py` marked `real_data` | Tasks 4, 16 |
| §11.5 operator evidence under `docs/evidence/` | Task 16 |
| §9.2 `ProjectOut.migration`, per-project isolation in `list_projects` | Task 7 |
| §14 migration budget (SQL UPDATE, JSON only on run rows, batches of 1000) | Tasks 11, 14; Budget |
| §15 library unavailable → waiting | Task 6 |
| §15 backup fails | Tasks 1, 5, 7 |
| §15 step fails → Retry resumes | Tasks 5, 15 |
| §15 folder unreadable | Task 7; ambiguity 8 |
| §15 catalogue unavailable | Task 15 |
| §16 migration tests | backup before `0010`: Tasks 1, 15. Byte-identical: Task 1. Idempotent, kill and resume: Tasks 3, 15. Rewrite across tables and JSON, totals equal: Task 11. Merge by name "dump_truck"/"Dump truck": Tasks 10, 15. Failed project doesn't break `GET /projects`: Task 7. Fixtures, pre-`0007` train and detect with maps, runs, clouds and volumes: Task 15 |
| §17.7 dry run passes, backup on first start, broken fixture skipped and flagged | Task 16 Steps 7–8 |
| §19.1 no deletes | Global Constraints; the steps only insert and update |
| F4 `object` default, `needs_classification` | Task 10 |
| F10 class maps app-wide | Task 12 |
| §8.1 migration numbering in `created_at` order | Task 14 |
| §6.1 legacy datasets | Task 13 |
