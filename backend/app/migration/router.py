"""`POST /projects/migrations/retry` and `/reveal-backup` (foundation spec §9.2, §11.3).

Retry upgrades a project again, after the operator fixed what stopped it. The job reopens the
folder, so a failed backup is retried too, and the step ledger resumes the data steps from the
first one not done. Restoring a backup stays a manual act ("Reveal backup"); nothing here
overwrites a database.
"""

import logging
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, field_validator

from app.errors import AppError, not_found
from app.library.handle import library_unavailable
from app.migration.gate import backup_path
from app.migration.job import live_job_id, states_for, submit
from app.migration.pipeline import TARGET_SCHEMA_VERSION
from app.migration.startup import probe_schema_version
from app.migration.state import MigrationStates
from app.projects.schemas import MigrationStateOut, _absolute

router = APIRouter(prefix="/projects/migrations", tags=["projects"])
log = logging.getLogger(__name__)


class MigrationRetry(BaseModel):
    """C0's `MigrationFolder`."""

    folder: str

    _folder_abs = field_validator("folder")(_absolute)


def _recent_id(registry, folder: Path) -> str | None:
    key = MigrationStates.key(folder)
    return next((r["id"] for r in registry.recent() if MigrationStates.key(r["folder"]) == key), None)


def _upgraded(folder: Path) -> bool:
    """True when the database already reports the target schema. Read-only; a database that cannot
    be read is not upgraded, so Retry lets the job open it and report why."""
    try:
        version = probe_schema_version(folder)
    except sqlite3.Error as e:
        log.warning("could not read the schema version of %s: %s", folder, e)
        return False
    return version is not None and version >= TARGET_SCHEMA_VERSION


def _folder(body: MigrationRetry) -> Path:
    """The resolved folder; a path Windows cannot resolve at all is simply not a project (404)."""
    try:
        return Path(body.folder).resolve()
    except (OSError, ValueError):
        raise not_found("project folder", body.folder) from None


@router.post("/retry", response_model=MigrationStateOut, status_code=202)
def retry_migration(body: MigrationRetry, request: Request) -> MigrationStateOut:
    registry, runner = request.app.state.projects, request.app.state.jobs
    folder = _folder(body)
    if not (folder / "project.db").is_file():
        raise not_found("project folder", str(folder))
    if getattr(runner, "library", None) is None:
        raise library_unavailable()
    if _upgraded(folder):
        raise AppError("conflict", "This project is already upgraded.", 409)
    states = states_for(registry)
    with states.locked():
        entry = states.get(folder) or {}
        live = live_job_id(runner, entry)
        if live is not None:
            raise AppError("job_running", "This project is already being upgraded.", 409, {"job_id": live})
        states.set(folder, state="pending", code=None, step=None, error=None, job_id=None)
        job = submit(runner, registry, folder, entry.get("project_id") or _recent_id(registry, folder))
    return MigrationStateOut(
        state="pending", job_id=job.id if job else None, backup_path=backup_path(entry, folder)
    )


@router.post("/reveal-backup", status_code=204)
def reveal_backup(body: MigrationRetry, request: Request) -> Response:
    """C0's `revealProjectBackup`: select the pre-upgrade copy in Explorer. The path is the one
    `migrations.json` records, else the newest backup on disk (the same one `Project.migration`
    shows), never text from the caller; nothing is restored."""
    from app.exports import reveal

    folder = _folder(body)
    found = backup_path(states_for(request.app.state.projects).get(folder) or {}, folder)
    if not found or not Path(found).is_file():
        raise not_found("backup", str(folder))
    reveal.launch(f'"{reveal.EXPLORER}" /select,"{Path(found).resolve()}"')
    return Response(status_code=204)
