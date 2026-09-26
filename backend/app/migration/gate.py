"""What a request may do with a project below the foundation schema (foundation spec §11.3, §15).

Disarmed (no steps) or at schema version 2, a project is `ok`. Otherwise it is `failed` (as
`migrations.json` records), `running` (its job is live in this process), or `pending` (no job can
run yet: the reason is in `error`).

`require_ready` is on every project-scoped request's hot path (F9): it must answer most requests
— a project already `ok` — without reading `migrations.json` at all, so it checks `armed()` and
the handle's cached `schema_version` first and returns immediately when neither applies. Only a
project still below the target schema pays for a state-file read. `migration_state` itself may
always read the file: the project list and `_out` (Task 7) need the full picture regardless.
"""

from app.errors import AppError
from app.migration.backup import latest_backup
from app.migration.job import armed, blocked_reason, live_job_id, states_for, submit
from app.migration.pipeline import TARGET_SCHEMA_VERSION
from app.migration.state import failed_error, upgrading_error


def _base(entry: dict, folder) -> dict:
    """Fields every `MigrationState` carries. `backup_path` falls back to the newest real backup
    on disk (F6) when `migrations.json` has none recorded yet — the window between the Alembic
    backup `open_project_db` takes and a `project_migrate` job recording its own backup_path."""
    backup_path = entry.get("backup_path")
    if not backup_path:
        found = latest_backup(folder)
        backup_path = str(found) if found else None
    return {
        "job_id": None,
        "error": None,
        "code": None,
        "step": None,
        "backup_path": backup_path,
        "report_path": entry.get("report_path"),
    }


def _failed(entry: dict, folder) -> dict:
    """The `failed` state dict, shared by `migration_state` and `unavailable_state` (F11): both
    read the same `migrations.json` entry and must not build this dict twice."""
    return {
        **_base(entry, folder),
        "state": "failed",
        "error": entry.get("error"),
        "code": entry.get("code"),
        "step": entry.get("step"),
    }


def migration_state(handle, runner) -> dict:
    entry = states_for(runner.projects).get(handle.folder) or {}
    if not armed() or handle.schema_version >= TARGET_SCHEMA_VERSION:
        return {**_base(entry, handle.folder), "state": "ok"}
    if entry.get("state") == "failed":
        return _failed(entry, handle.folder)
    job_id = live_job_id(runner, entry)
    return {
        **_base(entry, handle.folder),
        "state": "running" if job_id else "pending",
        "job_id": job_id,
        "error": None if job_id else blocked_reason(runner),
    }


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
    """Raise 409 `project_upgrading` or `project_upgrade_failed` unless the project is `ok`.

    Returns immediately, before `migrations.json` is ever read, when the project needs no gate at
    all (F9): disarmed, or already at the target schema version (the common case on every
    project-scoped request). Only a project still below the target schema reads the state file.
    """
    if not armed() or handle.schema_version >= TARGET_SCHEMA_VERSION:
        return
    state = migration_state(handle, runner)
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
        return _failed(entry, folder)
    message = error.message if isinstance(error, AppError) else f"{type(error).__name__}: {error}"
    return {**_base(entry, folder), "state": "failed", "error": message, "code": "open_failed"}
