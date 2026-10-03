"""The Site 3D scene manifest, `getSiteScene` (spec 2026-10-03-plant-model-generator §10-§11, plan S1).

One bounded read per call: the chosen model's ready version (its `spec.site` is the frame), else the
map workspace frame; the workspace's ready maps and placed raster drawings (the rows
`listWorkspaceLayers` reads, tens); at most MAX_LIST ready clouds; two counts. Every list is capped at
MAX_LIST. URLs are server-relative and carry no token: the client adds its base URL and token (plan
ruling R1). No file is opened here.
"""

from __future__ import annotations

import logging
import math
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from pyproj import CRS
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, AssetModelVersion, Finding, Image, PointCloud
from app.errors import not_found
from app.projects.service import ProjectHandle, get_project
from app.workspace import grid
from app.workspace.frame import SiteFrame as WorkspaceFrame
from app.workspace.frame import same_crs
from app.workspace.layers import list_layers

log = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])

MAX_LIST = 200
ORIGIN_STEP_M = 100.0
Z0_SPAN_M = grid.TILE * grid.RES0  # 262 144 m: one zoom-0 site tile
BBox = tuple[float, float, float, float]


class SceneCrs(BaseModel):
    epsg: int | None = None
    wkt: str | None = None


class SceneDatum(BaseModel):
    label: str = "EL"
    el_m: float = 0.0


class SceneFrame(BaseModel):
    crs: SceneCrs
    origin_crs: tuple[float, float]
    plant_north_deg: float
    datum: SceneDatum


class SceneModel(BaseModel):
    id: str
    version: int
    glb_url: str
    csv_url: str
    kind: Literal["asset", "plant"]


class SceneOrtho(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: BBox
    min_z: int
    max_z: int


class SceneCloud(BaseModel):
    id: str
    name: str
    octree_url: str
    crs_epsg: int | None
    same_crs: bool
    z_offset_m: float


class SceneDrawing(BaseModel):
    id: str
    name: str
    tile_url_template: str
    bounds_site: BBox


class SceneCount(BaseModel):
    count: int
    url: str


class SiteSceneOut(BaseModel):
    frame: SceneFrame | None
    model: SceneModel | None
    orthos: list[SceneOrtho]
    clouds: list[SceneCloud]
    drawings: list[SceneDrawing]
    photos: SceneCount
    findings: SceneCount


def _ready_version(s: Session, model: AssetModel) -> AssetModelVersion | None:
    q = select(AssetModelVersion).where(
        AssetModelVersion.model_id == model.id, AssetModelVersion.glb_status == "ready"
    )
    if model.current_version is not None:
        row = s.scalar(q.where(AssetModelVersion.version == model.current_version))
        if row is not None:
            return row
    return s.scalar(q.order_by(AssetModelVersion.version.desc()).limit(1))


def choose_model(s: Session, model_id: str | None) -> tuple[AssetModel, AssetModelVersion | None] | None:
    """Ruling R2: the asked-for model (404 when unknown), else the newest plant with a ready GLB."""
    if model_id is not None:
        row = s.get(AssetModel, model_id)
        if row is None:
            raise not_found("asset model", model_id)
        return row, _ready_version(s, row)
    plants = s.scalars(
        select(AssetModel)
        .where(AssetModel.kind == "plant")
        .order_by(AssetModel.created_at.desc(), AssetModel.id)
        .limit(MAX_LIST)
    )
    for row in plants:
        version = _ready_version(s, row)
        if version is not None:
            return row, version
    return None


def frame_from_site(site: object) -> SceneFrame | None:
    """A version's `spec.site` as the scene frame; None when absent or malformed (never a 500)."""
    if not isinstance(site, dict):
        return None
    try:
        crs = site.get("crs") or {}
        datum = site.get("datum") or {}
        ox, oy = site["origin_crs"]
        return SceneFrame(
            crs=SceneCrs(epsg=crs.get("epsg"), wkt=crs.get("wkt")),
            origin_crs=(float(ox), float(oy)),
            plant_north_deg=float(site["plant_north_deg"]),
            datum=SceneDatum(label=str(datum.get("label") or "EL"), el_m=float(datum.get("el_m") or 0.0)),
        )
    except (AttributeError, KeyError, TypeError, ValueError):
        log.warning("site scene: a model's site frame is malformed; using the map workspace frame")
        return None


def _frame_wkt(frame: SceneFrame) -> str | None:
    if frame.crs.wkt:
        return frame.crs.wkt
    if frame.crs.epsg:
        try:
            return CRS.from_epsg(int(frame.crs.epsg)).to_wkt()
        except Exception:
            return None
    return None


def _same(a: str | None, b: str | None) -> bool:
    """Ruling R5: equal only when both have a CRS and pyproj says they are the same."""
    if a is None or b is None:
        return False
    try:
        return same_crs(a, b)
    except Exception:
        return False


def _workspace_frame(ws: WorkspaceFrame, boxes: list[BBox], origin: tuple[float, float] | None) -> SceneFrame:
    if origin is None:
        minx = min(b[0] for b in boxes)
        miny = min(b[1] for b in boxes)
        maxx = max(b[2] for b in boxes)
        maxy = max(b[3] for b in boxes)
        step = ORIGIN_STEP_M
        origin = (
            float(round((minx + maxx) / 2 / step) * step) + 0.0,
            float(round((miny + maxy) / 2 / step) * step) + 0.0,
        )
    crs = SceneCrs(epsg=ws.epsg, wkt=ws.crs_wkt) if ws.kind == "crs" else SceneCrs()
    return SceneFrame(crs=crs, origin_crs=origin, plant_north_deg=0.0, datum=SceneDatum())


def min_zoom_for(bounds: BBox, max_z: int) -> int:
    """Ruling R7: the zoom where one site tile spans the footprint's longer side."""
    side = max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1e-6)
    return max(0, min(int(math.floor(math.log2(Z0_SPAN_M / side))), max_z))


def _tiles(base: str, kind: str, layer_id: str, version: str, frame_key: str) -> str:
    query = urlencode({"v": version, "frame_key": frame_key})
    return f"{base}/site-tiles/{kind}/{layer_id}/{{z}}/{{x}}/{{y}}?{query}"


def build_scene(handle: ProjectHandle, model_id: str | None) -> SiteSceneOut:
    base = f"/api/v1/projects/{handle.id}"
    ws, rows = list_layers(handle)
    ws_wkt = ws.crs_wkt if ws.kind == "crs" else None
    model_out: SceneModel | None = None
    site: object = None
    with handle.session() as s:
        chosen = choose_model(s, model_id)
        if chosen is not None and chosen[1] is not None:
            row, version = chosen
            v = version.version
            model_out = SceneModel(
                id=row.id,
                version=v,
                glb_url=f"{base}/asset-models/{row.id}/versions/{v}/glb",
                csv_url=f"{base}/asset-models/{row.id}/versions/{v}/csv",
                kind="plant" if row.kind == "plant" else "asset",
            )
            site = (version.spec or {}).get("site")
        clouds = [
            (c.id, c.name, c.crs_wkt, c.epsg, list(c.bounds_native or []))
            for c in s.scalars(
                select(PointCloud)
                .where(PointCloud.status == "ready")
                .order_by(PointCloud.created_at.desc(), PointCloud.id)
                .limit(MAX_LIST)
            )
        ]
        photos = int(
            s.scalar(
                select(func.count()).select_from(Image).where(Image.lat.is_not(None), Image.lon.is_not(None))
            )
            or 0
        )
        findings = int(
            s.scalar(
                select(func.count()).select_from(Finding).where(Finding.anchor_kind.in_(("map", "cloud")))
            )
            or 0
        )

    maps = [r for r in rows if r.kind == "map" and r.in_frame and r.footprint_site and r.max_zoom is not None]
    drawings = [
        r
        for r in rows
        if r.kind == "drawing"
        and r.placed
        and r.in_frame
        and r.tile_kind == "drawing_raster"
        and r.footprint_site
    ]

    frame = frame_from_site(site)
    if frame is None:
        boxes: list[BBox] = [tuple(r.footprint_site) for r in maps + drawings]
        boxes += [
            (b[0], b[1], b[3], b[4]) for _, _, wkt, _, b in clouds if len(b) == 6 and _same(wkt, ws_wkt)
        ]
        if boxes:
            frame = _workspace_frame(ws, boxes, None)
        elif model_out is not None:
            frame = _workspace_frame(ws, [], (0.0, 0.0))  # R3: a model with no site and nothing placed
    scene_wkt = _frame_wkt(frame) if frame is not None else None

    tiles_ok = frame is not None and (
        (ws.kind == "crs" and _same(ws_wkt, scene_wkt)) or (ws.kind == "local" and scene_wkt is None)
    )
    if not tiles_ok and (maps or drawings):
        log.info("site scene: %d tile layers left out (workspace frame differs)", len(maps) + len(drawings))
    orthos_out = (
        [
            SceneOrtho(
                id=r.id,
                name=r.name,
                tile_url_template=_tiles(base, "map", r.id, r.version, ws.key),
                bounds_site=tuple(r.footprint_site),
                min_z=min_zoom_for(tuple(r.footprint_site), r.max_zoom),
                max_z=r.max_zoom,
            )
            for r in maps
        ][:MAX_LIST]
        if tiles_ok
        else []
    )
    drawings_out = (
        [
            SceneDrawing(
                id=r.id,
                name=r.name,
                tile_url_template=_tiles(base, "drawing_raster", r.id, r.version, ws.key),
                bounds_site=tuple(r.footprint_site),
            )
            for r in drawings
        ][:MAX_LIST]
        if tiles_ok
        else []
    )

    cz = site.get("cloud_z_to_el") if isinstance(site, dict) else None
    clouds_out = [
        SceneCloud(
            id=cid,
            name=name,
            octree_url=f"{base}/pointclouds/{cid}/octree/metadata.json",
            crs_epsg=epsg,
            same_crs=_same(wkt, scene_wkt),
            z_offset_m=(
                float(cz["offset_m"])
                if isinstance(cz, dict) and cz.get("cloud_id") == cid and cz.get("offset_m") is not None
                else 0.0
            ),
        )
        for cid, name, wkt, epsg, _ in clouds
    ][:MAX_LIST]
    first_same = next((c for c in clouds_out if c.same_crs), None)
    return SiteSceneOut(
        frame=frame,
        model=model_out,
        orthos=orthos_out,
        clouds=clouds_out,
        drawings=drawings_out,
        photos=SceneCount(
            count=photos, url=f"{base}/pointclouds/{first_same.id}/cameras" if first_same else ""
        ),
        findings=SceneCount(count=findings, url=f"{base}/map-workspace/findings"),
    )


@router.get("/site-scene", response_model=SiteSceneOut)
def get_site_scene(
    modelId: str | None = Query(None, max_length=64),  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> SiteSceneOut:
    return build_scene(handle, modelId)
