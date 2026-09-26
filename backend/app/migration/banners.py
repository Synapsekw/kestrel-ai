"""The Overview banner for an upgrade that left notes (foundation spec §9.1, §11.4).

It reads only the project's small report file, so the Overview stays a bounded read.
"""

import json
from pathlib import Path

from app.migration.pipeline import REPORT_NAME


def migration_banners(handle) -> list[dict]:
    try:
        report = json.loads((Path(handle.folder) / "backups" / REPORT_NAME).read_text("utf-8"))
    except (OSError, ValueError):
        return []
    n = len(report.get("warnings") or []) if isinstance(report, dict) else 0
    if not n:
        return []
    notes = "1 note" if n == 1 else f"{n} notes"
    return [
        {
            "kind": "migration_warning",
            "tone": "warn",
            "message": (
                f"The upgrade finished with {notes}. "
                f"They are listed in backups/{REPORT_NAME} in the project folder."
            ),
            "action": None,
        }
    ]


def register() -> None:
    """Append `migration_banners` to the Overview's providers once, however often it is called."""
    from app.overview.service import BANNER_PROVIDERS

    if migration_banners not in BANNER_PROVIDERS:
        BANNER_PROVIDERS.append(migration_banners)
