"""`GET /api/v1/jobs` (spec 2026-09-26-foundation section 10.1): every job in the app, newest first.

The sources are the library runner's jobs and the jobs of every recent project open in this
process. Each source answers `limit + 1` rows in `(created_at desc, id desc)` order through
`ix_job_created`, and the pages are merged: a page costs at most 1 + MAX_RECENT small queries. A
source that fails is logged and left out; it never fails the list. Cancel and log stay on the
per-project and `/library/jobs` routes, chosen by `project_id`.
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, tuple_

from app.db.models import Job
from app.errors import AppError
from app.jobs.schemas import JobOut
from app.pagination import clamp_limit, decode_cursor, encode_cursor

log = logging.getLogger(__name__)
LIBRARY = "library"

router = APIRouter(prefix="/jobs", tags=["jobs"])


class AppJob(JobOut):
    project_name: str | None


class AppJobPage(BaseModel):
    items: list[AppJob]
    next_cursor: str | None


def _after(cursor: str | None) -> tuple[datetime, str] | None:
    c = decode_cursor(cursor, "created_at", "id")
    if not c:
        return None
    try:
        at = datetime.fromisoformat(str(c["created_at"]))
    except ValueError:
        raise AppError("validation_error", "invalid cursor", 422) from None
    return (at if at.tzinfo else at.replace(tzinfo=UTC)), str(c["id"])


def _sources(request: Request, project_id: str | None) -> list:
    registry = request.app.state.projects
    library = getattr(request.app.state, "library", None)
    if project_id == LIBRARY:
        return [library] if library is not None else []
    if project_id is not None:
        try:
            return [registry.get(project_id)]
        except AppError:  # not a known project: an empty page, not an error
            return []
        except Exception:
            log.exception("could not open project %s for the jobs list", project_id)
            return []
    return ([library] if library is not None else []) + registry.open_recent()


def _read(handle, state, type_, after, n: int) -> list[AppJob]:
    q = select(Job).order_by(Job.created_at.desc(), Job.id.desc())
    if state:
        q = q.where(Job.state.in_(state))
    if type_:
        q = q.where(Job.type.in_(type_))
    if after is not None:
        q = q.where(tuple_(Job.created_at, Job.id) < after)
    with handle.session() as s:
        rows = list(s.execute(q.limit(n)).scalars())
        for r in rows:
            s.expunge(r)
        name = None if handle.id == LIBRARY or not rows else handle.row(s).name
    return [AppJob(**JobOut.from_row(r, handle.id).model_dump(), project_name=name) for r in rows]


@router.get("", response_model=AppJobPage)
def list_app_jobs(
    request: Request,
    state: list[str] | None = Query(None),
    type: list[str] | None = Query(None),  # noqa: A002 - the contract's parameter name
    project_id: str | None = None,
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> AppJobPage:
    n = clamp_limit(limit)
    after = _after(cursor)
    items: list[AppJob] = []
    for handle in _sources(request, project_id):
        try:
            items += _read(handle, state, type, after, n + 1)
        except Exception:
            log.exception("jobs of %s could not be read; left out of the jobs list", handle.id)
    items.sort(key=lambda j: (j.created_at, j.id), reverse=True)
    next_cursor = None
    if len(items) > n:
        items = items[:n]
        next_cursor = encode_cursor(created_at=items[-1].created_at.isoformat(), id=items[-1].id)
    return AppJobPage(items=items, next_cursor=next_cursor)
