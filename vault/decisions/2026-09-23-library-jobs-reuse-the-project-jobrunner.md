---
type: adr
date: 2026-09-23
status: accepted
tags: [decision, jobs, library]
related: ["[[2026-09-17-jobs-are-per-project]]", "[[2026-09-23-train-detect-split-and-model-library-design]]"]
---

# Library jobs reuse the project JobRunner via a project-shaped handle

## Context

The model library (`%APPDATA%\kestrel-ai\library`) is app-wide, not per project. Importing a model
file, exporting one to ONNX and downloading a starter model are long work, so each one has to be a
background job with progress, a log, cancel and the orphan sweep at startup. Jobs have been per
project since [[2026-09-17-jobs-are-per-project]]. The `JobRunner` takes a `ProjectHandle`, writes
the `job` row through `handle.session()`, puts the log under `handle.runs_dir`, and tags every
websocket event with `handle.id`.

A second runner, or a global job table, would have meant a second copy of the cancellation, log,
progress and sweep code that took four waves to get right.

## Decision

`app/library/handle.py` defines `LibraryHandle`, shaped like a `ProjectHandle`:

- `id` is the constant `"library"`.
- `folder` is the library root.
- `runs_dir` is `<root>/runs`.
- `session()` opens a session on `library.db`.

`library.db` (its own Alembic history in `app/library/migrations/`) has a `job` table with exactly
the columns of `app.db.models.Job`, so the same ORM class reads and writes it. The one `JobRunner`
in `app.state.jobs` runs `library_import`, `library_export` and `library_starter` against the
library handle. The REST surface is `/library/jobs`. Websocket events carry `project_id: "library"`,
and the frontend files jobs with that id under the library.

`runner.library` holds the same handle (or `None`). Project jobs that need library models, such as
`train` registering its result or `library_adopt`, reach the library through it.

## Rationale

- One runner means one implementation of progress, cancel, logs and the startup sweep.
  `sweep_orphans(app.state.library, runner)` needed no change.
- The contract's `Job` schema needed no new shape: `project_id` is documented as "the project id,
  or `library` for library jobs".
- The library still stands alone: its own SQLite file and its own migrations. A broken
  `library.db` sets `app.state.library = None` and every library route answers `503
  library_unavailable`. The app still starts.

## Consequences

- Positive: no duplicate job machinery. Library jobs show in the header's Jobs button next to
  project jobs.
- Negative: the handle contract is implicit (duck typing). A new attribute the runner starts to
  read from a `ProjectHandle` must also exist on `LibraryHandle`, or library jobs break at run time,
  not at import. `tests/test_library_jobs.py` runs a library job end to end, which catches that.
- Negative: the `job` table's columns are duplicated in two migration histories. A new column on
  `app.db.models.Job` needs a library migration too.
- Trap: `"library"` is a reserved project id. Code that looks a job's `project_id` up in the
  project registry must check for it first.

## Related

- `backend/app/library/handle.py`, `backend/app/library/db.py`, `backend/app/jobs/runner.py`
- Spec `docs/superpowers/specs/2026-09-23-train-detect-split-and-model-library-design.md` §4
