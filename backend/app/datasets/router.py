"""Sources, images, boxes and datasets (spec sections 5 and 6)."""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, tuple_

from app.datasets import importer  # noqa: F401 - registers the "import" job type
from app.datasets.grouping import slugify
from app.datasets.schemas import SourceCreate, SourceOut, SourcePage, SourceWithJob
from app.db.models import Source
from app.errors import AppError, not_found
from app.jobs.schemas import JobOut
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.schemas import ImportSettings, Stats
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["datasets"])


def _cursor_datetime(value) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        raise AppError("validation_error", "invalid cursor", 422) from None


def _source(handle: ProjectHandle, source_id: str) -> Source:
    with handle.session() as s:
        row = s.get(Source, source_id)
        if row is None:
            raise not_found("source", source_id)
        s.expunge(row)
        return row


@router.get("/sources", response_model=SourcePage)
def list_sources(
    handle: ProjectHandle = Depends(get_project),
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> SourcePage:
    n = clamp_limit(limit)
    q = select(Source).order_by(Source.created_at, Source.id)
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        after = _cursor_datetime(c["created_at"])
        q = q.where(tuple_(Source.created_at, Source.id) > (after, str(c["id"])))
    with handle.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
    return SourcePage(items=[SourceOut.from_row(r) for r in rows], next_cursor=next_cursor)


@router.post("/sources", response_model=SourceWithJob, status_code=202)
def create_source(
    body: SourceCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> SourceWithJob:
    folder = Path(body.folder).resolve()
    if not folder.is_dir():
        # 404, not 422: a well-formed path that is not on disk is a missing resource, and the
        # contract's positive-data-acceptance check forbids rejecting schema-valid bodies with 422.
        raise not_found("source folder", str(folder))
    site = slugify(body.site or folder.name) or "source"
    with handle.session() as s:
        defaults = dict(handle.row(s).import_defaults or {})
        if body.settings is not None:
            defaults.update(body.settings.model_dump(exclude_unset=True))
        settings = ImportSettings(**defaults).model_dump()
        row = s.execute(select(Source).where(Source.folder == str(folder))).scalar_one_or_none()
        if row is None:  # re-posting a known folder re-imports it instead of adding a second source
            row = Source(folder=str(folder), site=site, settings=settings)
            s.add(row)
        else:
            row.settings = settings  # a re-import may use different preparation settings
        s.flush()
        source_id = row.id
    job = request.app.state.jobs.submit(handle, "import", {"source_id": source_id})
    with handle.session() as s:
        row = s.get(Source, source_id)
        row.job_id = job.id
        s.flush()
        s.expunge(row)
    return SourceWithJob(source=SourceOut.from_row(row), job=JobOut.from_row(job, handle.id))


@router.get("/sources/{sourceId}", response_model=SourceOut)
def get_source(sourceId: str, handle: ProjectHandle = Depends(get_project)) -> SourceOut:  # noqa: N803
    return SourceOut.from_row(_source(handle, sourceId))


@router.get("/sources/{sourceId}/stats", response_model=Stats)
def source_stats(sourceId: str, handle: ProjectHandle = Depends(get_project)) -> Stats:  # noqa: N803
    _source(handle, sourceId)
    return Stats()


add_stubs(
    router,
    [
        ("GET", "/images", "images list"),
        ("POST", "/images/bulk-delete", "images bulk-delete"),
        ("GET", "/images/{imageId}", "images get"),
        ("GET", "/images/{imageId}/file", "images file"),
        ("GET", "/images/{imageId}/thumbnail", "images thumbnail"),
        ("GET", "/images/{imageId}/boxes", "boxes list"),
        ("POST", "/images/{imageId}/boxes", "boxes create"),
        ("PATCH", "/boxes/{boxId}", "boxes update"),
        ("DELETE", "/boxes/{boxId}", "boxes delete"),
        ("POST", "/boxes/review", "boxes review"),
        ("GET", "/datasets", "datasets list"),
        ("POST", "/datasets", "datasets create"),
        ("GET", "/datasets/{datasetId}", "datasets get"),
        ("GET", "/datasets/{datasetId}/stats", "datasets stats"),
    ],
)
