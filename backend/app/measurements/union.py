"""`GET /projects/{id}/measurements`: every measurement of a project, newest first (spec
2026-09-26-map-workspace §4 item 8, §12; programme ruling R7). Bounded: one statement per chosen
provider, `limit + 1` rows each, merged in Python on a keyset cursor. `list_page` is also the
Python entry point for Reports (R §7.2) and the palette."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.measurements.providers import PROVIDERS, decode_key, encode_key, merge
from app.measurements.schemas import MeasurementKind, MeasurementPage, MeasurementSubKind
from app.pagination import clamp_limit
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["workspace"])


def list_page(
    handle: ProjectHandle,
    *,
    kinds: list[str] | None = None,
    sub_kinds: list[str] | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> MeasurementPage:
    n = clamp_limit(limit)
    after = decode_key(cursor)
    chosen = [p for k, p in PROVIDERS.items() if not kinds or k in kinds]
    with handle.session() as s:
        pages = [p.page(s, after, n + 1, sub_kinds or None) for p in chosen]
    items, last = merge(pages, n)
    return MeasurementPage(items=items, next_cursor=encode_key(last) if last else None)


@router.get("/measurements", response_model=MeasurementPage)
def list_measurements(
    handle: ProjectHandle = Depends(get_project),
    kind: list[MeasurementKind] | None = Query(None),
    sub_kind: list[MeasurementSubKind] | None = Query(None),
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
) -> MeasurementPage:
    return list_page(handle, kinds=kind, sub_kinds=sub_kind, limit=limit, cursor=cursor)
