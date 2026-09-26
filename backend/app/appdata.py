"""Per-user app data under %APPDATA%/kestrel-ai: recent projects and settings. Never keys."""

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

MAX_RECENT = 20


def _parse_last_opened_at(value: object) -> datetime | None:
    """A malformed or missing timestamp answers `None` rather than raising: a damaged app-data
    file must never turn into a 500 (AGENTS.md "the app must start even when startup work fails")."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


class AppData:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._recent = self.data_dir / "recent_projects.json"
        self._settings = self.data_dir / "settings.json"

    def recent(self) -> list[dict]:
        if not self._recent.exists():
            return []
        try:
            items = json.loads(self._recent.read_text("utf-8"))
        except json.JSONDecodeError:
            return []
        if not isinstance(items, list):
            return []
        return [r for r in items if isinstance(r, dict) and {"id", "name", "folder"} <= set(r)]

    def remember(self, project_id: str, name: str, folder: str) -> None:
        """Move a project to the top of the recent list. Entries written before the project kind
        was removed may still carry a `kind` key; `recent()` ignores it and this rewrite drops it."""
        items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
        items.insert(
            0,
            {
                "id": project_id,
                "name": name,
                "folder": folder,
                "last_opened_at": datetime.now(UTC).isoformat(),
            },
        )
        self._write(self._recent, items[:MAX_RECENT])

    def last_opened_at(self, project_id: str) -> datetime | None:
        """The recent-list entry's `last_opened_at` for one project id; `None` if the project has
        no entry (or the entry's timestamp is malformed)."""
        for r in self.recent():
            if r["id"] == project_id:
                return _parse_last_opened_at(r.get("last_opened_at"))
        return None

    def last_opened_map(self) -> dict[str, datetime | None]:
        """id -> `last_opened_at`, read from the recent list once (bounded by `MAX_RECENT`). Used
        by `list_projects` so it does not re-read the file once per project."""
        return {r["id"]: _parse_last_opened_at(r.get("last_opened_at")) for r in self.recent()}

    def forget(self, folder: str) -> None:
        items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
        self._write(self._recent, items)

    def read_settings(self) -> dict:
        if not self._settings.exists():
            return {}
        return json.loads(self._settings.read_text("utf-8"))

    def write_settings(self, values: dict) -> None:
        self._write(self._settings, values)

    @staticmethod
    def _write(path: Path, value) -> None:
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_text(json.dumps(value, indent=2), "utf-8")
        os.replace(tmp, path)
