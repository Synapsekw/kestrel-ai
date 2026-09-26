"""`findings.changed` (spec 2026-09-26-foundation section 8.3).

Every finding write marks its ids on the session; one after-commit listener publishes them. Routes,
jobs, the box hooks and M's map review therefore all publish the same way, only for work that
really committed, and once per transaction.
"""

from collections.abc import Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

MAX_IDS = 100
_KEY = "findings_changed"
_bus = None


def set_bus(bus) -> None:
    """The app's EventBus, wired in the lifespan."""
    global _bus
    _bus = bus


def mark_changed(s: Session, project_id: str, ids: Iterable[str]) -> None:
    pending: dict[str, set[str]] = s.info.setdefault(_KEY, {})
    pending.setdefault(project_id, set()).update(ids)


@event.listens_for(Session, "after_commit")
def _publish(s: Session) -> None:
    pending = s.info.pop(_KEY, None)
    if not pending or _bus is None:
        return
    for project_id, ids in pending.items():
        payload = {"ids": sorted(ids)} if len(ids) <= MAX_IDS else {"all": True}
        _bus.publish(
            {
                "type": "findings.changed",
                "project_id": project_id,
                "job_id": None,
                "progress": None,
                "message": "",
                "payload": payload,
            }
        )


@event.listens_for(Session, "after_rollback")
def _forget(s: Session) -> None:
    s.info.pop(_KEY, None)
