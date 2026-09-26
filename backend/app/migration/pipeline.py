"""Running the migration's data steps in order, resumably (foundation spec §11.4).

`run_pipeline` skips every step the ledger already records, and runs each remaining step in one
project transaction together with its ledger record. It ends with `finish`: the report
`<project>/backups/migration-v2.json` is written first, then `project.schema_version = 2` and the
`finish` record commit together. A failure raises `StepFailed` naming the step; nothing after it
runs, and a later run starts from that step.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.appdata import AppData
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
            {
                "name": step.name,
                "skipped": False,
                "seconds": round(time.monotonic() - t0, 3),
                "detail": detail,
            }
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
    AppData._write(path, report)
    with handle.session() as s:
        s.execute(text("UPDATE project SET schema_version = :v"), {"v": TARGET_SCHEMA_VERSION})
        ledger.record(s, FINISH, {"report": REPORT_NAME})
    return path
