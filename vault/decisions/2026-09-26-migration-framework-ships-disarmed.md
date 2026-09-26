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
- A job's terminal state (`ok`/`failed`) is written to `migrations.json` before the runner stops
  counting the job live, so a Retry that lands in that window still sees a live `job_id` and
  answers 409 `job_running`; tests wait for `is_live` to go `False` too, not just for the state
  write, to avoid a flaky race (`runner.py` itself is unchanged).
- A graceful app quit mid-upgrade leaves the entry `pending`: `app.migration.job.begin_shutdown()`
  sets a module-level signal from the lifespan just before the library runner stops, and a
  `JobCancelled` raised inside `migrate_project` while it is set is logged and left `pending` so
  the next start resumes it from the step ledger, instead of being flagged as if the operator
  cancelled it. A job still queued at shutdown is marked `cancelled` by `JobRunner.stop` without
  ever running `migrate_project`, so its entry is also left `pending`. A user-initiated cancel (the
  signal not set) flags the entry `failed`/`cancelled`.
- `GET /projects` reads an already-open project through `ProjectRegistry.cached()`, a lock-free
  lookup over a `dict.copy()` of the open handles, so the list never waits on the registry lock a
  job holds while it backs that project up (F12). This only covers a project already open in this
  process: the first listing of a project that has never been opened still calls `reg.open()`,
  which takes the registry lock and can wait behind another project's backup running under that
  same lock. Per-folder locks would close this gap but are out of scope for Part A.
- A project flagged `backup_failed` has no cached handle (`_backup_failed` raises before the
  handle is cached), so every `GET /projects` calls `reg.cached(folder) or reg.open(folder, ...)`,
  finds nothing cached, and reopens it — retrying the backup under the registry lock on every
  list call. Once the cause is fixed, an ordinary list request is what runs the backup and the
  upgrade, not a dedicated retry action.
- `POST /projects/migrations/reveal-backup` and `app.migration.gate.backup_path` both fall back to
  the newest file in `<project>/backups` (`latest_backup`) when `migrations.json` records no
  `backup_path` — the window between the Alembic-time copy-first backup and a `project_migrate`
  job recording its own path (F6).

## Related

- `backend/app/migration/`, `backend/app/db/session.py`, `backend/scripts/migration_dry_run.py`
- `backend/app/projects/router.py`, `backend/app/migration/router.py`
