"""`migrations.json`: each project's upgrade state, keyed by its lower-cased folder (spec §11.3).

It lives in the app-data folder beside `recent_projects.json`, so a project that cannot be opened
still has a state to show. Stored states are `pending`, `ok` and `failed`; `running` is derived
by the gate from a live job. Every write is atomic (temp file + replace) and serialised by one
process-wide lock, reusing `AppData._write` (F11) so this file and `recent_projects.json` share one
atomic-write implementation. A file that cannot be read is treated as empty and logged, never
raised: the app must start even when this file is damaged (AGENTS.md).
"""

from __future__ import annotations

import json
import logging
import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.appdata import AppData
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
            self.path.parent.mkdir(parents=True, exist_ok=True)
            AppData._write(self.path, data)
            return dict(entry)


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
