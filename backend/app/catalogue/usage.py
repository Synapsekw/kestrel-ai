"""Which open projects still use a severity level (spec 2026-09-26-foundation section 7.2)."""

import logging

from sqlalchemy import func, select

from app.db.models import FindingCount

log = logging.getLogger(__name__)


def _best_effort_name(registry, project_id: str) -> str:
    """A name for a project whose own session could not be read, from the registry's recent list
    (appdata), falling back to the id itself so the project is still named in the 409 details."""
    for r in registry.appdata.recent():
        if r["id"] == project_id:
            return r["name"]
    return project_id


def projects_using_level(registry, level: int) -> list[str]:
    """Names of the open projects whose findings (any status) carry `level`: one SUM over the small
    `finding_count` table each. A project that is not open is not asked; a finding there whose level
    no longer exists renders as "Level 5 (removed)" (spec section 7.2).

    Fails closed: a project whose counts cannot be read (a locked or corrupt `project.db`) is
    counted as using the level, not skipped, so a scale edit never drops a level a project it could
    not check still relies on. That project is still named in the 409 details, best-effort."""
    with registry._lock:  # the registry's own list of open projects (spec section 10.1 reads it too)
        handles = list(registry._handles.values())
    names: list[str] = []
    for h in handles:
        try:
            with h.session() as s:
                n = s.execute(
                    select(func.coalesce(func.sum(FindingCount.n), 0)).where(FindingCount.severity == level)
                ).scalar_one()
                if n:
                    names.append(h.row(s).name)
        except Exception:
            log.exception(
                "could not read finding counts of project %s; counting it as using level %s", h.id, level
            )
            names.append(_best_effort_name(registry, h.id))
    return sorted(names)
