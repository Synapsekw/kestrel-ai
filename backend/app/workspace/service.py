"""The workspace's one-row state (spec 2026-09-26-map-workspace section 6): the site frame, the
persisted view state and the planned surveys.

The first read creates the row with rule M3 (local metres when nothing has coordinates yet, as the
contract says). A local frame that holds no local item re-derives on the next read (plan deviation
9), so a project opened before its first import still follows that import's CRS.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import GeoMap, MapWorkspace, Surface
from app.errors import AppError
from app.projects.service import ProjectHandle
from app.workspace.frame import LOCAL, SiteFrame, frame_for_crs, frame_for_epsg

MAX_STATE_BYTES = 64 * 1024
_LOCK = threading.Lock()  # one sidecar process: two first reads must not both insert row 1


@dataclass
class Workspace:
    frame: SiteFrame
    state: dict
    planned_surveys: list[dict]
    updated_at: datetime


def _count(s: Session, model, *where) -> int:
    return int(s.execute(select(func.count()).select_from(model).where(*where)).scalar_one())


def frame_items(s: Session) -> dict[str, int]:
    """Maps and surfaces each frame can show: the CRS chip's "Local metres · 2 surfaces"."""
    crs = _count(s, GeoMap, GeoMap.status == "ready", GeoMap.crs_wkt.is_not(None)) + _count(
        s, Surface, Surface.status == "ready", Surface.crs_wkt.is_not(None)
    )
    local = _count(s, Surface, Surface.status == "ready", Surface.crs_wkt.is_(None))
    return {"crs": crs, "local": local}


def _georeferenced(s: Session) -> list[tuple[datetime, str, tuple[float, float] | None]]:
    out = []
    maps = select(GeoMap).where(GeoMap.status == "ready", GeoMap.crs_wkt.is_not(None))
    for m in s.execute(maps).scalars():
        b = m.bounds_wgs84
        centre = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) if b else None
        out.append((m.created_at, m.crs_wkt, centre))
    surfaces = select(Surface).where(Surface.status == "ready", Surface.crs_wkt.is_not(None))
    for srf in s.execute(surfaces).scalars():
        out.append((srf.created_at, srf.crs_wkt, None))
    return sorted(out, key=lambda c: c[0])


def choose_frame(s: Session) -> SiteFrame | None:
    """Rule M3 over the ready items, or None while nothing has coordinates."""
    for _, wkt, centre in _georeferenced(s):
        try:
            return frame_for_crs(wkt, centre)
        except AppError:
            continue  # an unusable CRS: the next item decides
    return None


def _row(s: Session) -> MapWorkspace | None:
    return s.execute(select(MapWorkspace).limit(1)).scalar_one_or_none()


def _frame_of(row: MapWorkspace) -> SiteFrame:
    return LOCAL if row.frame_kind == "local" else SiteFrame("crs", row.crs_wkt, row.epsg)


def _set(row: MapWorkspace, frame: SiteFrame) -> None:
    row.frame_kind, row.crs_wkt, row.epsg = frame.kind, frame.crs_wkt, frame.epsg


def _stale_local(s: Session, row: MapWorkspace) -> bool:
    return row.frame_kind == "local" and frame_items(s)["local"] == 0


def _out(row: MapWorkspace) -> Workspace:
    return Workspace(_frame_of(row), dict(row.state or {}), list(row.planned_surveys or []), row.updated_at)


def _ensure(s: Session) -> MapWorkspace:
    """The row, created or re-derived by M3. Callers hold _LOCK."""
    row = _row(s)
    if row is None:
        row = MapWorkspace(state={}, planned_surveys=[], updated_at=utcnow())
        _set(row, choose_frame(s) or LOCAL)
        s.add(row)
        s.flush()
    elif _stale_local(s, row):
        chosen = choose_frame(s)
        if chosen is not None:
            _set(row, chosen)
            row.updated_at = utcnow()
    return row


def load(handle: ProjectHandle) -> Workspace:
    with handle.session() as s:  # the fast path: one read, no lock
        row = _row(s)
        if row is not None and not _stale_local(s, row):
            return _out(row)
    with _LOCK, handle.session() as s:
        return _out(_ensure(s))


def get_frame(handle: ProjectHandle) -> SiteFrame:
    return load(handle).frame


def set_frame(handle: ProjectHandle, *, kind: str, epsg: int | None) -> Workspace:
    if kind == "local":
        frame = LOCAL
    elif epsg is None:
        raise AppError("invalid_epsg", "a crs frame needs an epsg code", 422)
    else:
        frame = frame_for_epsg(epsg)
    with _LOCK, handle.session() as s:
        row = _ensure(s)
        _set(row, frame)
        row.updated_at = utcnow()
        return _out(row)


def put_state(handle: ProjectHandle, *, state: dict, planned_surveys: list[dict] | None) -> Workspace:
    if len(json.dumps(state, separators=(",", ":")).encode("utf-8")) > MAX_STATE_BYTES:
        raise AppError(
            "state_too_large", f"the workspace state is larger than {MAX_STATE_BYTES // 1024} KB", 422
        )
    with _LOCK, handle.session() as s:
        row = _ensure(s)
        row.state = state
        if planned_surveys is not None:
            row.planned_surveys = planned_surveys
        row.updated_at = utcnow()
        return _out(row)
