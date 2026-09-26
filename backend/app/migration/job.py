"""The `project_migrate` job (foundation spec §11.3, F8): one per project, in the library runner.

The job opens the project through the registry, which takes the copy-first backup and upgrades the
schema, then runs the data steps (`app.migration.steps.PIPELINE`) and records the outcome in
`migrations.json`. It is resumable: the step ledger lets a new job start where a failed or
cancelled one stopped. While `PIPELINE` is empty the orchestration is disarmed (`armed()`), and
the job only opens the project.

A cancel is flagged `failed/cancelled` unless it is a graceful app shutdown (`begin_shutdown`,
wired into the lifespan just before the library runner stops): a quit mid-upgrade must leave the
entry `pending` so the next start resumes it, not flag it as if the operator cancelled it.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.library.handle import LIBRARY_UNAVAILABLE
from app.migration import steps
from app.migration.backup import latest_backup
from app.migration.pipeline import FINISH, TARGET_SCHEMA_VERSION, MigrationEnv, StepFailed, run_pipeline
from app.migration.state import MigrationStates

JOB_TYPE = "project_migrate"
WAITING_FOR_LIBRARY = "Waiting for the model library: this project opens once the library is available."
CANCELLED = "The upgrade was cancelled. Retry to finish it."
log = logging.getLogger(__name__)

_shutdown = threading.Event()


def begin_shutdown() -> None:
    """Call once from the lifespan's shutdown, before the library runner stops: a `JobCancelled`
    raised inside `migrate_project` while this is set is a graceful quit, not an operator cancel,
    so the entry is left `pending` for the next start to resume rather than flagged
    `failed/cancelled` (controller ruling on the app-quit-mid-upgrade scenario). A job still queued
    at shutdown never runs `migrate_project` or `_cancelled_before_start` at all (`JobRunner.stop`
    marks it `cancelled` directly), so its entry is already left `pending` with nothing extra to do
    here."""
    _shutdown.set()


def reset_shutdown() -> None:
    """Test/startup hook: clear the signal so a new app, or the next test's app, starts clean."""
    _shutdown.clear()


def _shutting_down() -> bool:
    return _shutdown.is_set()


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


def _project_id_for(runner, folder: Path, entry: dict) -> str:
    """The event's `project_id` (F1): the entry's, else the id of the folder's recent-list
    entry, else `"library"` when neither is known."""
    project_id = entry.get("project_id")
    if project_id:
        return project_id
    registry = getattr(runner, "projects", None)
    if registry is not None:
        key = MigrationStates.key(folder)
        for r in registry.recent():
            if r["folder"].lower() == key:
                return r["id"]
    return "library"


def publish(runner, folder, entry: dict) -> None:
    """`migration.changed` (C0): `state` is the `MigrationState` state, so a `pending` entry whose
    job is already live is reported as `running` (F3) — the same derivation `GET`/Retry use, not
    the raw stored value."""
    state = entry.get("state")
    if state == "pending" and live_job_id(runner, entry):
        state = "running"
    runner.events.publish(
        {
            "type": "migration.changed",
            "project_id": _project_id_for(runner, folder, entry),
            "job_id": entry.get("job_id"),
            "progress": None,
            "message": "",
            "payload": {
                "folder": str(folder),
                "state": state,
                "job_id": entry.get("job_id"),
                "code": entry.get("code"),
            },
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


def _cancelled_before_start(ctx) -> None:
    """A queued `project_migrate` job cancelled before it ever ran (both workers were busy):
    `migrate_project` never runs, so flag `failed/cancelled` here instead, or the entry stays
    `pending` with a dead job id that startup would silently re-queue."""
    runner = ctx.runner
    folder = Path(ctx.params["folder"])
    _fail(runner, states_for(runner.projects), folder, code="cancelled", step=None, error=CANCELLED)


@register_job_type(JOB_TYPE, on_cancelled_before_start=_cancelled_before_start)
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
        if e.code == "project_upgrade_failed":
            # The registry's own `_backup_failed` already flagged `failed/backup_failed`; publish
            # that entry (F7) rather than re-flagging it with a different code.
            publish(runner, folder, states.get(folder) or {})
        else:
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
            if _shutting_down():
                # A graceful quit, not an operator cancel: leave the entry `pending` so the next
                # start resumes it (the ledger skips whatever steps already committed).
                ctx.log.info("upgrade for %s left pending: the app is shutting down", folder)
            else:
                _fail(runner, states, folder, code="cancelled", step=None, error=CANCELLED)
            raise
        except StepFailed as e:
            _fail(
                runner,
                states,
                folder,
                code="step_failed",
                step=e.step,
                error=e.message,
                backup_path=_backup(handle.folder),
            )
            raise JobFailure(f"The upgrade stopped at step {e.step}: {e.message}") from e
        except Exception as e:
            # `run_pipeline` also writes the report and commits `finish` (pipeline.py) outside any
            # per-step try; that failure must still flag the project rather than leave it `pending`
            # with a dead job id for startup to silently re-queue.
            message = f"{type(e).__name__}: {e}"
            _fail(
                runner,
                states,
                folder,
                code="step_failed",
                step=FINISH,
                error=message,
                backup_path=_backup(handle.folder),
            )
            raise JobFailure(f"The upgrade could not finish: {message}") from e
        handle.schema_version = TARGET_SCHEMA_VERSION
    try:
        entry = states.set(
            folder,
            state="ok",
            code=None,
            step=None,
            error=None,
            project_id=handle.id,
            backup_path=_backup(handle.folder),
            report_path=report.get("report_path"),
        )
    except Exception as e:
        # Recording the outcome can itself fail (migrations.json write error); the same risk of a
        # silently re-queued `pending` project applies, so flag it here too.
        message = f"{type(e).__name__}: {e}"
        _fail(
            runner,
            states,
            folder,
            code="step_failed",
            step=None,
            error=message,
            backup_path=_backup(handle.folder),
        )
        raise JobFailure(f"The upgrade result could not be recorded: {message}") from e
    publish(runner, folder, entry)
    return {
        "project_id": handle.id,
        "folder": str(folder),
        "steps_run": sum(1 for s in report["steps"] if not s.get("skipped")),
        "warnings": len(report["warnings"]),
        "report_path": report.get("report_path"),
    }
