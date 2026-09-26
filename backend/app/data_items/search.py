"""`GET /projects/{id}/search` (spec 2026-09-26-foundation section 10.3): the command palette's
in-project search.

Two groups, each at most `limit` rows. Data items match on their label through the Data list
providers. Findings come from the search the findings module registers (unit BC); until then that
group is empty. Neither group reads the image table.
"""

import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.data_items.providers import PROVIDERS, merge
from app.data_items.schemas import DataItem
from app.projects.service import ProjectHandle, get_project

log = logging.getLogger(__name__)

MIN_QUERY = 2
DEFAULT_LIMIT = 8
MAX_LIMIT = 20

FindingSearch = Callable[[Session, str, int], list[dict[str, Any]]]
_finding_search: FindingSearch | None = None


def register_finding_search(fn: FindingSearch | None) -> None:
    """Called by the findings module on import: `fn(session, q, limit)` gets the trimmed query and
    returns at most `limit` findings in the contract's `Finding` shape. None unregisters."""
    global _finding_search
    _finding_search = fn


def like_pattern(q: str) -> str:
    """`q` as a LIKE pattern matched anywhere, with `\\`, `%` and `_` taken literally (ESCAPE '\\')."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class SearchResult(BaseModel):
    findings: list[dict[str, Any]]
    data: list[DataItem]


router = APIRouter(prefix="/projects/{projectId}", tags=["data"])


@router.get("/search", response_model=SearchResult)
def search_project(
    handle: ProjectHandle = Depends(get_project),
    q: str = Query("", max_length=200),
    limit: int = Query(DEFAULT_LIMIT, ge=1),
) -> SearchResult:
    text = q.strip()
    if len(text) < MIN_QUERY:
        return SearchResult(findings=[], data=[])
    n = min(limit, MAX_LIMIT)
    pattern = like_pattern(text)
    with handle.session() as s:
        pages = [p.search(s, pattern, n) for p in PROVIDERS.values()]
        findings: list[dict[str, Any]] = []
        if _finding_search is not None:
            try:
                findings = _finding_search(s, text, n)[:n]
            except Exception:
                log.exception("finding search failed; the findings group is left empty")
    data, _ = merge(pages, n)
    return SearchResult(findings=findings, data=data)
