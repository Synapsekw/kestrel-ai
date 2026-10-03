# backend/app/asset_review/routes_placements.py
"""Placements on an asset model (spec 2026-10-02-asset-findings §8): the keyset-paged index for the
current version, the three binaries of one patch (with an ETag), and the compute job."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.asset_review import jobs_place, place
from app.asset_review.placement_schemas import ComputePlacementsIn, PlacementList, PlacementOut
from app.db.models import AssetModel, Box, Finding, FindingSighting
from app.errors import not_found
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])
P = "/asset-models/{assetModelId}/placements"
MAX_PAGE = 2000
BINARY_HEADERS = {"Cache-Control": "private, no-cache"}
KINDS = {
    "mesh": (".bin", "application/octet-stream"),
    "texture": (".png", "image/png"),
    "labels": (".lbl", "application/octet-stream"),
}


def _model(s, asset_model_id: str) -> AssetModel:
    row = s.get(AssetModel, asset_model_id)
    if row is None:
        raise not_found("asset model", asset_model_id)
    return row


@router.get(P, response_model=PlacementList)
def list_placements(
    assetModelId: str,  # noqa: N803
    after: str | None = None,
    limit: int = Query(MAX_PAGE, ge=1, le=MAX_PAGE),
    handle: ProjectHandle = Depends(get_project),
) -> PlacementList:
    with handle.session() as s:
        version = _model(s, assetModelId).current_version
        if version is None:
            return PlacementList(version=None, items=[], next=None)
        q = (
            select(FindingSighting, func.coalesce(FindingSighting.severity, Finding.severity), Box.class_id)
            .join(Box, Box.id == FindingSighting.annotation_id)
            .outerjoin(Finding, Finding.id == FindingSighting.finding_id)
            .where(
                FindingSighting.asset_model_id == assetModelId,
                FindingSighting.placed_version == version,
                FindingSighting.placement.in_(("point", "patch")),
            )
            .order_by(FindingSighting.id)
        )
        if after:
            q = q.where(FindingSighting.id > after)
        rows = s.execute(q.limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    index = place.read_index(jobs_place.placements_dir(handle, assetModelId, version))
    items = []
    for sg, severity, type_id in rows:
        patch = sg.placement == "patch"
        entry = index.get(sg.id) if patch else None
        items.append(
            PlacementOut(
                sighting_id=sg.id,
                finding_id=sg.finding_id,
                kind=sg.placement,
                center=[sg.cx, sg.cy, sg.cz],
                normal=[sg.nx, sg.ny, sg.nz],
                size=float(max(entry["size"])) if entry and entry.get("size") else 0.0,
                severity=severity,
                type_id=type_id,
                has_patch=patch and bool(sg.patch_path),
            )
        )
    return PlacementList(version=version, items=items, next=rows[-1][0].id if more and rows else None)


def _patch_file(handle: ProjectHandle, asset_model_id: str, sighting_id: str, suffix: str) -> Path:
    """The file of a patch placed on the model's current version; 404 for anything else."""
    with handle.session() as s:
        version = _model(s, asset_model_id).current_version
        row = s.execute(
            select(FindingSighting).where(
                FindingSighting.id == sighting_id, FindingSighting.asset_model_id == asset_model_id
            )
        ).scalar_one_or_none()
        if row is None or row.placement != "patch" or not row.patch_path or row.placed_version != version:
            raise not_found("placement", sighting_id)
        rel = row.patch_path
    path = (handle.folder / rel).with_suffix(suffix)
    if not path.is_file():
        raise not_found("placement", sighting_id)
    return path


def _binary(request: Request, path: Path, media_type: str, sighting_id: str) -> Response:
    st = path.stat()
    etag = f'"{sighting_id}-{st.st_mtime_ns:x}-{st.st_size:x}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, **BINARY_HEADERS})
    return FileResponse(path, media_type=media_type, headers={"ETag": etag, **BINARY_HEADERS})


def _route(kind: str):
    suffix, media_type = KINDS[kind]

    def get_binary(
        assetModelId: str,  # noqa: N803
        sightingId: str,  # noqa: N803
        request: Request,
        handle: ProjectHandle = Depends(get_project),
    ) -> Response:
        return _binary(request, _patch_file(handle, assetModelId, sightingId, suffix), media_type, sightingId)

    get_binary.__name__ = f"get_placement_{kind}"
    return get_binary


for _kind in KINDS:
    router.add_api_route(
        P + "/{sightingId}/" + _kind, _route(_kind), methods=["GET"], response_class=Response
    )


@router.post(P + "/compute", response_model=JobRef, status_code=202)
def compute_placements(
    assetModelId: str,  # noqa: N803
    request: Request,
    body: ComputePlacementsIn | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    only_dirty = bool(body.only_dirty) if body is not None else False
    job = jobs_place.submit(handle, request.app.state.jobs, assetModelId, only_dirty)  # 409 job_running
    return JobRef(job=JobOut.from_row(job, handle.id))
