"""`GET /projects/{id}/data`: every data item of a project, newest capture first (spec
2026-09-26-foundation section 6.3). Bounded: one statement per provider, `limit + 1` rows each."""

from fastapi import APIRouter, Depends, Query

from app.data_items.providers import PROVIDERS, decode_key, encode_key, merge
from app.data_items.schemas import DataItemPage, DataItemType
from app.pagination import clamp_limit
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["data"])


@router.get("/data", response_model=DataItemPage)
def list_data(
    handle: ProjectHandle = Depends(get_project),
    type: list[DataItemType] | None = Query(None),  # noqa: A002 - the contract's parameter name
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> DataItemPage:
    n = clamp_limit(limit)
    after = decode_key(cursor)
    chosen = [p for t, p in PROVIDERS.items() if not type or t in type]
    with handle.session() as s:
        pages = [p.page(s, after, n + 1) for p in chosen]
    items, last = merge(pages, n)
    return DataItemPage(items=items, next_cursor=encode_key(last) if last else None)
