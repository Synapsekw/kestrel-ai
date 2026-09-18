"""Query run creation, listing, promotion and synchronous pre-annotation (spec sections 7 and 8)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.db.models import Box, Image, QueryRun
from app.errors import AppError, not_found
from app.inference.schemas import QueryRunCreate
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyStore
from app.providers.tiling import make_tiles
from app.training import registry

LOCAL_COST_PER_REQUEST = 0.0


def class_ids_by_name(handle: ProjectHandle, s: Session) -> dict[str, str]:
    return {c["name"]: c["id"] for c in handle.row(s).classes or []}


def class_names(handle: ProjectHandle, s: Session) -> list[str]:
    return [c["name"] for c in handle.row(s).classes or []]


def _images(s: Session, image_ids: list[str]) -> list[Image]:
    """Every requested image, in the order asked for. An unknown id is a 404, not a silent skip."""
    found = {row.id: row for row in s.execute(select(Image).where(Image.id.in_(image_ids))).scalars()}
    missing = [i for i in image_ids if i not in found]
    if missing:
        raise not_found("image", missing[0])
    return [found[i] for i in image_ids]


def _cost_per_request(config: ProviderConfigStore, body: QueryRunCreate) -> float:
    if body.kind == "local_model":
        return LOCAL_COST_PER_REQUEST
    return config.get(body.provider).cost_per_request


def _tile_count(s: Session, body: QueryRunCreate) -> tuple[int, int]:
    spec = body.tiling.to_spec()
    images = _images(s, body.image_ids)
    return len(images), sum(len(make_tiles(i.width, i.height, spec)) for i in images)


def estimate(handle: ProjectHandle, config: ProviderConfigStore, body: QueryRunCreate):
    with handle.session() as s:
        images, tiles = _tile_count(s, body)  # unknown images are a 404 before anything else
    _validate(handle, config, body, check_key=False, keys=None)
    per_request = _cost_per_request(config, body)
    return {
        "images": images,
        "tiles": tiles,
        "requests": tiles,
        "cost_per_request": per_request,
        "estimated_cost": round(tiles * per_request, 6),
    }


def _validate(
    handle: ProjectHandle,
    config: ProviderConfigStore,
    body: QueryRunCreate,
    *,
    check_key: bool,
    keys: KeyStore | None,
) -> str | None:
    """The model name the run records, or the contract's error for each missing precondition.

    `QueryRunCreate` cannot express "model_id is required for local_model" or a non-empty query, so
    those are checked here. The images are resolved first, because a body that names no real image
    is answered 404 whatever else is wrong with it.
    """
    if body.kind == "local_model":
        if not body.model_id:
            raise AppError("validation_error", "a local model run needs model_id", 422)
        return registry.get_model(handle, body.model_id).name
    if not body.provider:
        raise AppError("validation_error", "a cloud provider run needs provider", 422)
    if not (body.query or "").strip():
        raise AppError("validation_error", "a cloud provider run needs a non-empty query", 422)
    if check_key and keys is not None and keys.get(body.provider) is None:
        raise AppError("conflict", f"no API key stored for {body.provider}", 409)
    return config.get(body.provider).model_name


def create_query_run(
    handle: ProjectHandle, keys: KeyStore, config: ProviderConfigStore, body: QueryRunCreate
) -> QueryRun:
    with handle.session() as s:
        _images(s, body.image_ids)  # unknown images are a 404 before anything else
    model_name = _validate(handle, config, body, check_key=True, keys=keys)
    with handle.session() as s:
        row = QueryRun(
            kind=body.kind,
            model_id=body.model_id if body.kind == "local_model" else None,
            provider=body.provider if body.kind == "cloud_provider" else None,
            model_name=model_name,
            query=(body.query or "").strip(),
            image_ids=list(body.image_ids),
            tiling=body.tiling.model_dump(),
            conf=body.conf,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def set_job(handle: ProjectHandle, run_id: str, job_id: str) -> QueryRun:
    with handle.session() as s:
        row = s.get(QueryRun, run_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def box_count(s: Session, run_id: str) -> int:
    return s.execute(select(func.count()).select_from(Box).where(Box.query_run_id == run_id)).scalar_one()


def get_query_run(handle: ProjectHandle, run_id: str) -> tuple[QueryRun, int]:
    with handle.session() as s:
        row = s.get(QueryRun, run_id)
        if row is None:
            raise not_found("query run", run_id)
        count = box_count(s, run_id)
        s.expunge(row)
    return row, count


def list_query_runs(
    handle: ProjectHandle, limit: int | None, cursor: str | None
) -> tuple[list[tuple[QueryRun, int]], str | None]:
    n = clamp_limit(limit)
    q = select(QueryRun).order_by(QueryRun.created_at.desc(), QueryRun.id.desc())
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        try:
            after = datetime.fromisoformat(str(c["created_at"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(tuple_(QueryRun.created_at, QueryRun.id) < (after, str(c["id"])))
    with handle.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        next_cursor = None
        if len(rows) > n:
            rows = rows[:n]
            next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
        out = [(row, box_count(s, row.id)) for row in rows]
        for row in rows:
            s.expunge(row)
    return out, next_cursor


def promote(
    handle: ProjectHandle, run_id: str, min_confidence: float
) -> tuple[QueryRun, int, int, list[str]]:
    """Accept the run's pending boxes at or above the threshold. A state change, never a copy."""
    now = datetime.now(UTC)
    with handle.session() as s:
        row = s.get(QueryRun, run_id)
        if row is None:
            raise not_found("query run", run_id)
        pending = list(
            s.execute(
                select(Box).where(
                    Box.query_run_id == run_id,
                    Box.review_state == "unreviewed",
                    func.coalesce(Box.confidence, 0.0) >= min_confidence,
                )
            ).scalars()
        )
        for box in pending:
            box.review_state, box.reviewed_at = "accepted", now
        row.promoted_at = now
        image_ids = sorted({b.image_id for b in pending})
        s.flush()
        count = box_count(s, run_id)
        s.expunge(row)
    return row, count, len(pending), image_ids
