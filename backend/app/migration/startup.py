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
