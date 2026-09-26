"""`migrations.json`: each project's upgrade state, keyed by its lower-cased folder (spec §11.3).

It lives in the app-data folder beside `recent_projects.json`, so a project that cannot be opened
still has a state to show. Stored states are `pending`, `ok` and `failed`; `running` is derived
by the gate from a live job. Every write is atomic (temp file + replace) and serialised by one
process-wide lock, reusing `AppData._write` (F11) so this file and `recent_projects.json` share one
atomic-write implementation. A file that cannot be read is treated as empty and logged, never
raised: the app must start even when this file is damaged (AGENTS.md). A write over such a file
first copies it aside to `migrations.json.damaged-<UTC stamp>` (never deleted), so a transient
read failure cannot silently drop every other project's entry; if even that copy fails, the write
is refused.
"""

from __future__ import annotations

import json
import logging
import shutil
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

    def _read(self) -> tuple[dict, bool]:
        """The entries, and whether a file exists that could not be read or parsed as a dict."""
        if not self.path.exists():
            return {}, False
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            log.exception("%s could not be read; treating it as empty", self.path)
            return {}, True
        return (data, False) if isinstance(data, dict) else ({}, True)

    def _keep_aside(self) -> None:
        """Copy the unreadable file to `migrations.json.damaged-<UTC stamp>` before it is replaced.
        An `OSError` here propagates: the write is refused rather than losing the file."""
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        target, n = self.path.with_name(f"{self.path.name}.damaged-{stamp}"), 2
        while target.exists():
            target, n = self.path.with_name(f"{self.path.name}.damaged-{stamp}-{n}"), n + 1
        shutil.copy2(self.path, target)
        log.error("%s could not be read; kept it as %s before writing a new one", self.path, target.name)

    def all(self) -> dict[str, dict]:
        with self._lock:
            return self._read()[0]

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
            data, damaged = self._read()
            if damaged:
                self._keep_aside()
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
