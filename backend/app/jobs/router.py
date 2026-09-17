from collections import deque
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, tuple_

from app.db.models import Job
from app.jobs.schemas import JobLog, JobOut, JobPage
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}/jobs", tags=["jobs"])


def _runner(request: Request):
    return request.app.state.jobs


@router.get("", response_model=JobPage)
def list_jobs(
    request: Request,
    handle: ProjectHandle = Depends(get_project),
    state: str | None = None,
    type: str | None = None,
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> JobPage:
    n = clamp_limit(limit)
    q = select(Job).order_by(Job.created_at.desc(), Job.id.desc())
    if state:
        q = q.where(Job.state == state)
    if type:
        q = q.where(Job.type == type)
    c = decode_cursor(cursor)
    if c:
        q = q.where(tuple_(Job.created_at, Job.id) < (datetime.fromisoformat(c["created_at"]), c["id"]))
    with handle.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        last = rows[-1]
        next_cursor = encode_cursor(created_at=last.created_at.isoformat(), id=last.id)
    return JobPage(items=[JobOut.from_row(r, handle.id) for r in rows], next_cursor=next_cursor)


@router.get("/{jobId}", response_model=JobOut)
def get_job(jobId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobOut:  # noqa: N803
    return JobOut.from_row(_runner(request).get(handle, jobId), handle.id)


@router.post("/{jobId}/cancel", response_model=JobOut)
def cancel_job(jobId: str, request: Request, handle: ProjectHandle = Depends(get_project)) -> JobOut:  # noqa: N803
    return JobOut.from_row(_runner(request).cancel(handle, jobId), handle.id)


@router.get("/{jobId}/log", response_model=JobLog)
def job_log(
    jobId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
    tail: int = Query(200, ge=1, le=10000),
) -> JobLog:
    job = _runner(request).get(handle, jobId)
    path = handle.folder / job.log_path
    lines: list[str] = []
    if path.exists():
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = [line.rstrip("\r\n") for line in deque(fh, maxlen=tail)]
    return JobLog(lines=lines, path=job.log_path)
