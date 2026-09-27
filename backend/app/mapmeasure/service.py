"""Map measurements (spec 2026-09-26-map-workspace §9.1, §9.2, M4, M5): CRUD whose `results` are
computed by the server on create and on a PATCH of vertices or surfaces.

Order of checks, as in `volumes/service.py`: lookups (404) and states (409) first, then the
business rules (422, each with its own code, never `validation_error`). Surfaces are resolved in
one session; the maths runs outside it; the row is written in a second session. The DB column
`geometry` holds the vertex list (M-C0 Ruling 18).

Contract rulings (binding, see `schemas.py`):
- C1: `vertices` returned is always the stored frame; `get(..., site=True)` also fills
  `vertices_site` (converted), or answers 409 `not_in_site_frame` on a frame-kind mismatch.
  `list_page(..., site=True)` omits a mismatched row instead (each frame shows its own items).
- C2: `patch(...)` takes no `site` keyword — PATCH has no `frame` query parameter, and its
  response always carries the stored-frame vertices only (`vertices_site` stays unset).
- C3: `list_page(..., kind=...)` is a single-value equality filter on `MapMeasurement.kind`.
- C4: `_results` stamps `dsm_surface_id` from the resolved DSM ref, not left null by
  `geodesy.distance_results`.
- Fix round 1: `list_page`'s `_list_results` backfills `stations_m: []`/`series: []` on a listed
  profile row (SQL still strips the actual arrays) because the contract's `MapProfileResults`
  requires both as non-nullable arrays, unlike the other two kinds, which never carry them.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import JSON, func, select, type_coerce
from sqlalchemy.orm import Session, defer

from app.db.models import GeoMap, MapMeasurement, Surface
from app.errors import AppError, not_found
from app.mapmeasure.frames import FrameMismatch, SiteFrame, convert_vertices, frame_of, require_site_frame
from app.mapmeasure.geodesy import area_results, distance_results, grid_length_m
from app.mapmeasure.profile import SurfaceRef, length_3d, profile
from app.mapmeasure.schemas import (
    MapMeasurementCreate,
    MapMeasurementKind,
    MapMeasurementOut,
    MapMeasurementPage,
    MapMeasurementPatch,
    MapMeasurementResults,
)
from app.pagination import newest_first_page
from app.projects.service import ProjectHandle
from app.surfaces.paths import surface_path
from app.volumes.engine import EngineFailure, ring_polygon

MAX_PER_PROJECT = 5000
LABELS = {"distance": "Distance", "area": "Area", "profile": "Profile"}
SURFACE_COUNT = {"distance": (0, 1), "area": (0, 0), "profile": (1, 3)}
SURFACE_WORDS = {
    "distance": "at most one elevation model",
    "area": "no surface",
    "profile": "one to three surfaces",
}


def _invalid(message: str, code: str = "invalid_geometry") -> AppError:
    return AppError(code, message, 422)


def _next_name(s: Session, kind: str) -> str:
    label = LABELS[kind]
    pattern = re.compile(rf"^{re.escape(label)} (\d+)$")
    names = s.execute(select(MapMeasurement.name).where(MapMeasurement.kind == kind)).scalars()
    numbers = [int(m.group(1)) for n in names if (m := pattern.match(n))]
    return f"{label} {max(numbers, default=0) + 1}"


def _checked(kind: str, vertices: list, frame: SiteFrame) -> list:
    """The vertices to store (an area ring open), or 422 `invalid_geometry`."""
    if kind == "area":
        if len(vertices) < 3:
            raise _invalid("an area needs at least three corners")
        try:
            ring_polygon(vertices)
        except EngineFailure as e:
            raise _invalid(str(e)) from e
        return vertices[:-1] if len(vertices) > 3 and vertices[0] == vertices[-1] else vertices
    if grid_length_m(vertices, frame) <= 0:
        raise _invalid("the line has no length; click two different points")
    return vertices


def _check_surface_count(kind: str, ids: list[str]) -> None:
    lo, hi = SURFACE_COUNT[kind]
    if len(set(ids)) != len(ids):
        raise _invalid("a surface is listed twice", "invalid_surfaces")
    if not lo <= len(ids) <= hi:
        raise _invalid(f"a {kind} takes {SURFACE_WORDS[kind]}", "invalid_surfaces")


def _surface_refs(s: Session, handle: ProjectHandle, ids: list[str], frame: SiteFrame) -> list[SurfaceRef]:
    refs = []
    for sid in ids:
        row = s.get(Surface, sid)
        if row is None:
            raise not_found("surface", sid)
        if row.status != "ready":
            raise AppError("not_ready", f"surface {row.name} is {row.status}, not ready", 409)
        if (row.crs_wkt is None) != (frame.kind == "local"):
            where = "local coordinates" if row.crs_wkt is None else "a coordinate system"
            raise _invalid(
                f"{row.name} has {where} and the site frame does not; choose another surface",
                "surface_not_in_frame",
            )
        refs.append(
            SurfaceRef(
                row.id,
                row.name,
                row.captured_on,
                row.crs_wkt,
                row.epsg,
                float(row.cell_size_m),
                surface_path(handle, row.id),
            )
        )
    return refs


def _results(kind: str, vertices: list, frame: SiteFrame, refs: list[SurfaceRef]) -> dict:
    if kind == "area":
        return area_results(vertices, frame)
    if kind == "profile":
        return profile(vertices, frame, refs)
    out = distance_results(vertices, frame)
    out["dsm_surface_id"] = refs[0].id if refs else None
    if refs:
        out["length_3d_m"], out["nodata_fraction"] = length_3d(
            vertices, frame, refs[0], out["scale_factor"] or 1.0
        )
    return out


def _out(
    row: MapMeasurement, results: dict | None, vertices: list, vertices_site: list | None = None
) -> MapMeasurementOut:
    return MapMeasurementOut(
        id=row.id,
        name=row.name,
        note=row.note,
        kind=row.kind,
        crs_wkt=row.crs_wkt,
        epsg=row.epsg,
        vertices=vertices,
        vertices_site=vertices_site,
        surface_ids=list(row.surface_ids or []),
        map_id=row.map_id,
        results=MapMeasurementResults.model_validate(results or {}),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _site_vertices(s: Session, row: MapMeasurement, site: bool) -> list | None:
    """`vertices_site` (C1): `None` unless `site=True`; a frame-kind mismatch is 409
    `not_in_site_frame` (the list omits the row instead; see `list_page`)."""
    if not site:
        return None
    try:
        return convert_vertices(row.geometry, frame_of(row.crs_wkt, row.epsg), require_site_frame(s))
    except FrameMismatch:
        raise AppError("not_in_site_frame", "this measurement was drawn in another site frame", 409) from None


def _list_results(row: MapMeasurement, results: dict | None) -> dict:
    """The list strips `stations_m`/`series` in SQL (`json_remove`, never loaded). A profile row's
    `results` must still carry both keys as empty arrays: the contract's `MapProfileResults`
    requires them as non-nullable arrays, unlike the two other kinds, which never had them."""
    out = dict(results or {})
    if row.kind == "profile":
        out.setdefault("stations_m", [])
        out.setdefault("series", [])
    return out


def _get(s: Session, measurement_id: str) -> MapMeasurement:
    row = s.get(MapMeasurement, measurement_id)
    if row is None:
        raise not_found("map measurement", measurement_id)
    return row


def create(handle: ProjectHandle, body: MapMeasurementCreate) -> MapMeasurementOut:
    with handle.session() as s:
        frame = require_site_frame(s)
        if body.map_id is not None and s.get(GeoMap, body.map_id) is None:
            raise not_found("map", body.map_id)
        refs = _surface_refs(s, handle, body.surface_ids, frame)
    _check_surface_count(body.kind, body.surface_ids)
    vertices = _checked(body.kind, body.vertices, frame)
    results = _results(body.kind, vertices, frame, refs)
    with handle.session() as s:
        if s.execute(select(func.count()).select_from(MapMeasurement)).scalar_one() >= MAX_PER_PROJECT:
            raise _invalid(
                f"this project already has {MAX_PER_PROJECT} map measurements; delete some first",
                "measurement_limit",
            )
        row = MapMeasurement(
            kind=body.kind,
            name=body.name or _next_name(s, body.kind),
            note=body.note,
            crs_wkt=frame.crs_wkt,
            epsg=frame.epsg,
            geometry=vertices,
            surface_ids=list(body.surface_ids),
            map_id=body.map_id,
            results=results,
        )
        s.add(row)
        s.flush()
        return _out(row, results, vertices)


def get(handle: ProjectHandle, measurement_id: str, *, site: bool) -> MapMeasurementOut:
    with handle.session() as s:
        row = _get(s, measurement_id)
        return _out(row, row.results, row.geometry, _site_vertices(s, row, site))


def list_page(
    handle: ProjectHandle,
    *,
    site: bool,
    limit: int | None,
    cursor: str | None,
    kind: MapMeasurementKind | None = None,
) -> MapMeasurementPage:
    with handle.session() as s:
        q = select(MapMeasurement).options(defer(MapMeasurement.results))
        if kind is not None:
            q = q.where(MapMeasurement.kind == kind)
        frame = require_site_frame(s) if site else None
        if frame is not None:
            only = (
                MapMeasurement.crs_wkt.is_(None)
                if frame.kind == "local"
                else MapMeasurement.crs_wkt.is_not(None)
            )
            q = q.where(only)
        rows, next_cursor = newest_first_page(
            s, q, MapMeasurement.created_at, MapMeasurement.id, limit, cursor
        )
        stripped = type_coerce(func.json_remove(MapMeasurement.results, "$.stations_m", "$.series"), JSON)
        ids = [r.id for r in rows]
        summaries = dict(
            s.execute(select(MapMeasurement.id, stripped).where(MapMeasurement.id.in_(ids))).all()
        )
        items = [
            _out(
                r,
                _list_results(r, summaries.get(r.id)),
                r.geometry,
                convert_vertices(r.geometry, frame_of(r.crs_wkt, r.epsg), frame) if frame else None,
            )
            for r in rows
        ]
    return MapMeasurementPage(items=items, next_cursor=next_cursor)


def patch(handle: ProjectHandle, measurement_id: str, body: MapMeasurementPatch) -> MapMeasurementOut:
    fields = body.model_fields_set
    new_vertices = body.vertices if "vertices" in fields and body.vertices is not None else None
    new_surfaces = body.surface_ids if "surface_ids" in fields and body.surface_ids is not None else None
    recompute = new_vertices is not None or new_surfaces is not None
    with handle.session() as s:
        row = _get(s, measurement_id)
        kind = row.kind
        vertices = new_vertices if new_vertices is not None else row.geometry
        surface_ids = new_surfaces if new_surfaces is not None else list(row.surface_ids or [])
        frame = require_site_frame(s) if new_vertices is not None else frame_of(row.crs_wkt, row.epsg)
        refs = _surface_refs(s, handle, surface_ids, frame) if recompute else []
    results = None
    if recompute:
        _check_surface_count(kind, surface_ids)
        vertices = _checked(kind, vertices, frame)
        results = _results(kind, vertices, frame, refs)
    with handle.session() as s:
        row = _get(s, measurement_id)
        if "name" in fields and body.name is not None:
            row.name = body.name
        if "note" in fields:
            row.note = body.note
        if recompute:
            row.geometry, row.surface_ids, row.results = vertices, list(surface_ids), results
            row.crs_wkt, row.epsg = frame.crs_wkt, frame.epsg
        row.updated_at = datetime.now(UTC)
        s.flush()
        return _out(row, row.results, row.geometry)


def delete(handle: ProjectHandle, measurement_id: str) -> None:
    with handle.session() as s:
        s.delete(_get(s, measurement_id))
