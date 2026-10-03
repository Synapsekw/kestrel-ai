"""The plant register over HTTP (spec 2026-10-03-plant-model-generator §10; plan A1 task 8): a paged,
filtered list of a version's `asset_item` index, one item from the stored spec, and the register CSV.
Bounded: <= 500 rows per page by keyset on `asset_item.node`; the item route validates one item only."""

from __future__ import annotations

import math
import re

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import FileResponse
from sqlalchemy import or_, select, text

from app.asset_models import store
from app.asset_models.schemas_plant import AssetItemPageOut, AssetItemRowOut
from app.asset_models.spec import FlagCode, Item
from app.asset_models.store import INT32_MAX
from app.db.models import AssetItem
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
V = "/asset-models/{assetModelId}/versions/{version}"
MAX_PAGE = 500
DEFAULT_PAGE = 200
ITEM_ID_PATTERN = r"^[A-Za-z0-9_.\-]{1,64}$"
BBOX_PATTERN = r"^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$"
_ITEM_ID = re.compile(ITEM_ID_PATTERN)
_FLAG_FILTER = text(
    "EXISTS (SELECT 1 FROM json_each(asset_item.flags) WHERE json_extract(json_each.value, '$.code') = :flag)"
)


def _cursor(raw: str | None) -> str | None:
    if raw is None:
        return None
    if not _ITEM_ID.fullmatch(raw):
        raise AppError("invalid_cursor", "The cursor is not valid; start again without one.", 422)
    return raw


def _bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    if raw is None:
        return None
    vals = [float(v) for v in raw.split(",")]  # the route's pattern guarantees four numbers
    if not all(math.isfinite(v) for v in vals) or vals[0] > vals[2] or vals[1] > vals[3]:
        raise AppError("invalid_bbox", "bbox must be minE,minN,maxE,maxN in plant metres.", 422)
    return vals[0], vals[1], vals[2], vals[3]


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get(V + "/items", response_model=AssetItemPageOut)
def list_asset_model_items(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    q: str | None = Query(None, max_length=120),
    type_: str | None = Query(None, alias="type", max_length=64),
    area: str | None = Query(None, max_length=80),
    flag: FlagCode | None = None,
    bbox: str | None = Query(None, pattern=BBOX_PATTERN),
    cursor: str | None = Query(None, max_length=200),
    limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        store.get_version(s, assetModelId, version)  # 404s before parameter checks
        after = _cursor(cursor)
        box = _bbox(bbox)
        stmt = select(AssetItem).where(AssetItem.model_id == assetModelId, AssetItem.version == version)
        if after is not None:
            stmt = stmt.where(AssetItem.node > after)
        if q:
            p = _like(q)
            stmt = stmt.where(
                or_(
                    AssetItem.tag.ilike(p, escape="\\"),
                    AssetItem.name.ilike(p, escape="\\"),
                    AssetItem.node.ilike(p, escape="\\"),
                )
            )
        if type_:
            stmt = stmt.where(AssetItem.type == type_)
        if area:
            stmt = stmt.where(AssetItem.area == area)
        if flag:
            stmt = stmt.where(_FLAG_FILTER.bindparams(flag=flag))
        if box:
            stmt = stmt.where(
                AssetItem.plant_e.between(box[0], box[2]), AssetItem.plant_n.between(box[1], box[3])
            )
        rows = s.scalars(stmt.order_by(AssetItem.node).limit(limit + 1)).all()
        more = len(rows) > limit
        rows = rows[:limit]
        return AssetItemPageOut(
            items=[AssetItemRowOut.of(r) for r in rows], next_cursor=rows[-1].node if more and rows else None
        )


@router.get(V + "/items/{itemId}", response_model=Item)
def get_asset_model_item(
    assetModelId: str,  # noqa: N803
    itemId: str = Path(pattern=ITEM_ID_PATTERN),  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        raw = store.get_version(s, assetModelId, version).spec
    for entry in raw.get("items") or []:
        if isinstance(entry, dict) and entry.get("id") == itemId:
            return Item.model_validate(entry)
    raise not_found("asset item", itemId)


@router.get(V + "/csv", response_class=FileResponse)
def get_asset_model_csv(
    assetModelId: str,  # noqa: N803
    version: int = Path(ge=1, le=INT32_MAX),
    handle: ProjectHandle = Depends(get_project),
):
    with handle.session() as s:
        ready = store.get_version(s, assetModelId, version).glb_status == "ready"
    path = store.version_csv_path(handle, assetModelId, version)
    if not ready or not path.exists():
        raise AppError("not_ready", "The register for this version is not built yet.", 409)
    return FileResponse(
        path,
        media_type="text/csv; charset=utf-8",
        filename=f"register-v{version}.csv",
        headers={"Cache-Control": "no-cache"},
    )
