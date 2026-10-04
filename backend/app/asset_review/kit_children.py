"""Run another job type inside the kit import (spec 2026-10-02-asset-findings §6.5 steps 6, 7).

The import attaches the kit's notes and source masks to the findings that grouping creates, so it
cannot hand the rest to queued jobs and finish first. It runs J1's `asset_glb_import` and J3's
`asset_place` in its own thread instead, through a child context:
- progress maps into a slice of the import's bar;
- cancel is the import's;
- a job the child would chain is swallowed, because the import runs that step itself next.
  `asset_place` queues `asset_group` through `jobs_group.submit_group`.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.registry import get_job_type


class _ChainGuard:
    """The child's runner: the import's runner, minus the job types the import runs itself."""

    def __init__(self, runner, swallow: frozenset[str]):
        self._runner, self._swallow = runner, swallow
        self.swallowed: list[str] = []

    def submit(self, project, type: str, params: dict):
        if type in self._swallow:
            self.swallowed.append(type)
            return SimpleNamespace(id=None, type=type, state="skipped")
        return self._runner.submit(project, type, params)

    def __getattr__(self, name):
        return getattr(self._runner, name)


class ChildContext:
    def __init__(self, parent, params: dict, lo: float, hi: float, swallow: frozenset[str] = frozenset()):
        self.project, self.job_id, self.log = parent.project, parent.job_id, parent.log
        self.cancelled = parent.cancelled
        self.params = dict(params)
        self.runner = _ChainGuard(parent.runner, swallow)
        self.last_message: str | None = None
        self._parent, self._lo, self._hi = parent, lo, hi

    def check_cancelled(self) -> None:
        self._parent.check_cancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        f = max(0.0, min(1.0, float(fraction)))
        self.last_message = message
        self._parent.progress(self._lo + (self._hi - self._lo) * f, message)

    def publish(self, type: str, payload: dict) -> None:
        self._parent.publish(type, payload)


def run_child(
    ctx, job_type: str, params: dict, lo: float, hi: float, swallow: frozenset[str] = frozenset()
) -> dict:
    try:
        fn = get_job_type(job_type)
    except AppError:
        raise JobFailure(f"This build has no {job_type} step, so the kit import cannot finish.") from None
    return fn(ChildContext(ctx, params, lo, hi, swallow)) or {}


class InlineRunner:
    """For a service that queues its job (J1's `start_import`): `submit` runs the job now, in this
    thread, inside the import. A failure raises out of `submit`, as a queue failure would."""

    def __init__(self, ctx, lo: float, hi: float):
        self._ctx, self._lo, self._hi = ctx, lo, hi

    def submit(self, project, type: str, params: dict):
        run_child(self._ctx, type, params, self._lo, self._hi)
        return SimpleNamespace(id=None, type=type, state="succeeded")
