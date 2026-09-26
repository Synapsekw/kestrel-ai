"""Sources, images, boxes and datasets (spec sections 5 and 6)."""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select, tuple_, update

# importer and materialise register the "import" and "dataset" job types on import.
from app.datasets import boxes, empties, images, importer, materialise, stats  # noqa: F401
from app.datasets.grouping import slugify
from app.datasets.schemas import (
    BoxCreate,
    BoxList,
    BoxOut,
    BoxReview,
    BoxReviewResult,
    BoxUpdate,
    BulkDelete,
    BulkDeleteResult,
    BulkMarkEmpty,
    BulkMarkEmptyResult,
    DatasetCreate,
    DatasetOut,
    DatasetPage,
    DatasetStats,
    DatasetWithJob,
    ImageOut,
    ImagePage,
    ImageSort,
    ImageUpdate,
    SortOrder,
    SourceCreate,
    SourceOut,
    SourcePage,
    SourcePatch,
    SourceWithJob,
)
from app.db.models import Dataset, DatasetImage, GeoMap, Source
from app.errors import AppError, not_found
from app.events_util import publish_image_ids_event
from app.jobs.schemas import JobOut
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.kinds import ANY_KIND, require_kind
from app.projects.schemas import ImportSettings, Stats
from app.projects.service import ProjectHandle, get_project

# Images, sources and boxes are shared storage (both kinds); datasets are training work only.
router = APIRouter(
    prefix="/projects/{projectId}", tags=["datasets"], dependencies=[Depends(require_kind(ANY_KIND))]
)
TRAIN_ONLY = [Depends(require_kind(("train",)))]
DETECT_ONLY = [Depends(require_kind(("detect",)))]


def _cursor_datetime(value) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        raise AppError("validation_error", "invalid cursor", 422) from None


def _set_job_id(handle: ProjectHandle, table, row_id: str, job_id: str) -> None:
    """The job is already running and may have finished (or removed the row); never fail on it."""
    with handle.session() as s:
        s.execute(update(table).where(table.id == row_id).values(job_id=job_id))


def _split_counts(handle: ProjectHandle, dataset_ids: list[str]) -> dict[tuple[str, str], int]:
    """Train and val counts for a whole page of datasets in one query."""
    with handle.session() as s:
        rows = s.execute(
            select(DatasetImage.dataset_id, DatasetImage.split, func.count())
            .where(DatasetImage.dataset_id.in_(dataset_ids))
            .group_by(DatasetImage.dataset_id, DatasetImage.split)
        ).all()
    return {(dataset_id, split): n for dataset_id, split, n in rows}


def _datasets_out(handle: ProjectHandle, rows: list[Dataset]) -> list[DatasetOut]:
    counts = _split_counts(handle, [r.id for r in rows])
    return [
        DatasetOut.from_row(r, counts.get((r.id, "train"), 0), counts.get((r.id, "val"), 0)) for r in rows
    ]


def _source(handle: ProjectHandle, source_id: str) -> Source:
    with handle.session() as s:
        row = s.get(Source, source_id)
        if row is None:
            raise not_found("source", source_id)
        s.expunge(row)
        return row


def _map_ids(s, source_ids: list[str]) -> dict[str, str]:
    """source id -> the map it owns, for one page of sources in one query."""
    if not source_ids:
        return {}
    rows = s.execute(select(GeoMap.source_id, GeoMap.id).where(GeoMap.source_id.in_(source_ids))).all()
    return {source_id: map_id for source_id, map_id in rows}


def _sources_out(handle: ProjectHandle, rows: list[Source]) -> list[SourceOut]:
    with handle.session() as s:
        maps = _map_ids(s, [r.id for r in rows])
    return [SourceOut.from_row(r, maps.get(r.id)) for r in rows]


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
    return SourcePage(items=_sources_out(handle, rows), next_cursor=next_cursor)


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
    _set_job_id(handle, Source, source_id, job.id)
    with handle.session() as s:
        row = s.get(Source, source_id)
        s.expunge(row)
    return SourceWithJob(source=_sources_out(handle, [row])[0], job=JobOut.from_row(job, handle.id))


@router.get("/sources/{sourceId}", response_model=SourceOut)
def get_source(sourceId: str, handle: ProjectHandle = Depends(get_project)) -> SourceOut:  # noqa: N803
    return _sources_out(handle, [_source(handle, sourceId)])[0]


@router.patch("/sources/{sourceId}", response_model=SourceOut, dependencies=DETECT_ONLY)
def update_source(
    sourceId: str,  # noqa: N803
    body: SourcePatch,
    handle: ProjectHandle = Depends(get_project),
) -> SourceOut:
    """A map source's survey date is its map's `captured_on`: both are written in one transaction."""
    sent = body.model_fields_set
    with handle.session() as s:
        row = s.get(Source, sourceId)
        if row is None:
            raise not_found("source", sourceId)
        if "label" in sent:
            row.label = body.label
        if "captured_on" in sent:
            row.captured_on = body.captured_on
            for gmap in s.execute(select(GeoMap).where(GeoMap.source_id == sourceId)).scalars():
                gmap.captured_on = body.captured_on
        s.flush()
        s.expunge(row)
    return _sources_out(handle, [row])[0]


@router.get("/sources/{sourceId}/stats", response_model=Stats)
def source_stats(sourceId: str, handle: ProjectHandle = Depends(get_project)) -> Stats:  # noqa: N803
    _source(handle, sourceId)
    return stats.compute_stats(handle, source_id=sourceId)


@router.get("/images", response_model=ImagePage)
def list_images(
    handle: ProjectHandle = Depends(get_project),
    source_id: str | None = None,
    group_key: str | None = None,
    labeled: bool | None = None,
    has_pending: bool | None = None,
    search: str | None = None,
    ids: str | None = Query(None, description="comma-separated image ids; overrides the other filters"),
    sort: ImageSort = "path",
    order: SortOrder = "asc",
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> ImagePage:
    rows, next_cursor, total = images.list_images(
        handle,
        source_id=source_id,
        group_key=group_key,
        labeled=labeled,
        has_pending=has_pending,
        search=search,
        ids=[i for i in ids.split(",") if i] if ids is not None else None,
        sort=sort,
        order=order,
        limit=limit,
        cursor=cursor,
    )
    return ImagePage(items=[ImageOut.from_row(*r) for r in rows], next_cursor=next_cursor, total=total)


@router.post("/images/bulk-delete", response_model=BulkDeleteResult)
def bulk_delete_images(body: BulkDelete, handle: ProjectHandle = Depends(get_project)) -> BulkDeleteResult:
    return BulkDeleteResult(deleted=images.bulk_delete(handle, body.image_ids))


@router.post("/images/bulk-mark-empty", response_model=BulkMarkEmptyResult)
def bulk_mark_empty_images(
    body: BulkMarkEmpty, request: Request, handle: ProjectHandle = Depends(get_project)
) -> BulkMarkEmptyResult:
    updated, skipped, rejected_ids = empties.bulk_mark_empty(handle, body.image_ids, body.marked_empty)
    publish_image_ids_event(request, handle, "images.changed", body.image_ids)
    publish_image_ids_event(request, handle, "boxes.changed", rejected_ids)
    return BulkMarkEmptyResult(updated=updated, skipped=skipped)


@router.get("/images/{imageId}", response_model=ImageOut)
def get_image(imageId: str, handle: ProjectHandle = Depends(get_project)) -> ImageOut:  # noqa: N803
    return ImageOut.from_row(*images.get_image(handle, imageId))


@router.patch("/images/{imageId}", response_model=ImageOut)
def update_image(
    imageId: str,  # noqa: N803
    body: ImageUpdate,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImageOut:
    row, rejected_ids = empties.set_marked_empty(handle, imageId, body.marked_empty)
    publish_image_ids_event(request, handle, "images.changed", [imageId])
    publish_image_ids_event(request, handle, "boxes.changed", rejected_ids)
    return ImageOut.from_row(*row)


@router.get("/images/{imageId}/file", response_class=FileResponse)
def get_image_file(
    imageId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
    max_side: int | None = Query(None, ge=64, le=8192),
) -> FileResponse:
    return FileResponse(images.image_file(handle, imageId, max_side), media_type="image/jpeg")


@router.get("/images/{imageId}/thumbnail", response_class=FileResponse)
def get_image_thumbnail(imageId: str, handle: ProjectHandle = Depends(get_project)) -> FileResponse:  # noqa: N803
    return FileResponse(images.thumbnail(handle, imageId), media_type="image/jpeg")


@router.get("/images/{imageId}/boxes", response_model=BoxList)
def list_boxes(imageId: str, handle: ProjectHandle = Depends(get_project)) -> BoxList:  # noqa: N803
    return BoxList(items=[BoxOut.from_row(b) for b in boxes.list_boxes(handle, imageId)])


@router.post("/images/{imageId}/boxes", response_model=BoxOut, status_code=201)
def create_box(
    imageId: str,  # noqa: N803
    body: BoxCreate,
    handle: ProjectHandle = Depends(get_project),
) -> BoxOut:
    row = boxes.create_box(handle, imageId, body.class_id, body.x, body.y, body.w, body.h, body.angle)
    return BoxOut.from_row(row)


@router.patch("/boxes/{boxId}", response_model=BoxOut)
def update_box(
    boxId: str,  # noqa: N803
    body: BoxUpdate,
    handle: ProjectHandle = Depends(get_project),
) -> BoxOut:
    return BoxOut.from_row(boxes.update_box(handle, boxId, **body.model_dump(exclude_unset=True)))


@router.delete("/boxes/{boxId}", status_code=204)
def delete_box(boxId: str, handle: ProjectHandle = Depends(get_project)) -> None:  # noqa: N803
    boxes.delete_box(handle, boxId)


@router.post("/boxes/review", response_model=BoxReviewResult)
def review_boxes(body: BoxReview, handle: ProjectHandle = Depends(get_project)) -> BoxReviewResult:
    return BoxReviewResult(updated=boxes.review_boxes(handle, body.box_ids, body.action))


@router.get("/datasets", response_model=DatasetPage, dependencies=TRAIN_ONLY)
def list_datasets(
    handle: ProjectHandle = Depends(get_project),
    limit: int | None = Query(None, ge=1, le=1000),
    cursor: str | None = None,
) -> DatasetPage:
    n = clamp_limit(limit)
    q = select(Dataset).order_by(Dataset.created_at.desc(), Dataset.id.desc())
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        before = _cursor_datetime(c["created_at"])
        q = q.where(tuple_(Dataset.created_at, Dataset.id) < (before, str(c["id"])))
    with handle.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
    return DatasetPage(items=_datasets_out(handle, rows), next_cursor=next_cursor)


@router.post("/datasets", response_model=DatasetWithJob, status_code=202, dependencies=TRAIN_ONLY)
def create_dataset(
    body: DatasetCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> DatasetWithJob:
    dataset_id = materialise.freeze(handle, body)
    with handle.session() as s:
        row = s.get(Dataset, dataset_id)
        s.expunge(row)
    out = _datasets_out(handle, [row])[0]  # read before the job starts: it may discard and fail
    job = request.app.state.jobs.submit(handle, "dataset", {"dataset_id": dataset_id})
    _set_job_id(handle, Dataset, dataset_id, job.id)
    return DatasetWithJob(
        dataset=out.model_copy(update={"job_id": job.id}), job=JobOut.from_row(job, handle.id)
    )


@router.get("/datasets/{datasetId}", response_model=DatasetOut, dependencies=TRAIN_ONLY)
def get_dataset(datasetId: str, handle: ProjectHandle = Depends(get_project)) -> DatasetOut:  # noqa: N803
    with handle.session() as s:
        row = s.get(Dataset, datasetId)
        if row is None:
            raise not_found("dataset", datasetId)
        s.expunge(row)
    return _datasets_out(handle, [row])[0]


@router.get("/datasets/{datasetId}/stats", response_model=DatasetStats, dependencies=TRAIN_ONLY)
def get_dataset_stats(datasetId: str, handle: ProjectHandle = Depends(get_project)) -> DatasetStats:  # noqa: N803
    return stats.dataset_stats(handle, datasetId)


@router.delete("/datasets/{datasetId}", status_code=204, dependencies=TRAIN_ONLY)
def delete_dataset(datasetId: str, handle: ProjectHandle = Depends(get_project)) -> None:  # noqa: N803
    materialise.delete_dataset(handle, datasetId)
