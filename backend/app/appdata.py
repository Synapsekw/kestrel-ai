"""Per-user app data under %APPDATA%/machinery-app: recent projects and settings. Never keys."""

import json
from datetime import UTC, datetime
from pathlib import Path

MAX_RECENT = 20


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
            return json.loads(self._recent.read_text("utf-8"))
        except json.JSONDecodeError:
            return []

    def remember(self, project_id: str, name: str, folder: str) -> None:
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
        self._recent.write_text(json.dumps(items[:MAX_RECENT], indent=2), "utf-8")

    def forget(self, folder: str) -> None:
        items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
        self._recent.write_text(json.dumps(items, indent=2), "utf-8")

    def read_settings(self) -> dict:
        if not self._settings.exists():
            return {}
        return json.loads(self._settings.read_text("utf-8"))

    def write_settings(self, values: dict) -> None:
        self._settings.write_text(json.dumps(values, indent=2), "utf-8")
