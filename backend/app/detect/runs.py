"""Detection runs over sources (spec 2026-09-23 sections 7.2-7.4; plan 2 unit R).

A photo source gets a `QueryRun` (the `infer` job) and a map source a `MapRun` (the `map_detect`
job). Everything a request can be refused for is checked before the first row is written, so a
refused request leaves no run and no job behind: unknown sources, a map that is not ready, a
missing model or library, and classes the project has no mapping for (`422 unmapped_classes`).

The runs list is the union of both tables. It reads run rows plus one grouped COUNT per table for
review progress: never a detection row.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, func, select, tuple_, update
from sqlalchemy.orm import Session

from app.db.models import Box, GeoMap, Image, Job, MapDetection, MapRun, QueryRun, Source
from app.detect import class_maps
from app.detect.areas import areas_for_map
from app.detect.counts import recount_map_run, recount_query_run
from app.detect.schemas import ReviewProgress, RunCreate, RunSummary
from app.errors import AppError, not_found
from app.inference.schemas import Tiling
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.library import service as library
from app.library.handle import LibraryHandle, library_unavailable
from app.pagination import clamp_limit, decode_cursor, encode_cursor
from app.projects.service import ProjectHandle
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyStore

READY = "ready"


@dataclass
class _Target:
    """One requested source, resolved: what kind of run it gets and over what."""

    source_id: str  # as requested
    kind: str  # images | map
    run_source_id: str | None  # the Source row's id; None for a map imported before sources
    image_ids: list[str]
    map_id: str | None = None


# ------------------------------------------------------------------------- creation


def _target(s: Session, source_id: str) -> _Target:
    source = s.get(Source, source_id)
    if source is None:
        # A map imported before maps had sources is listed by its map row; accept its id.
        gmap = s.get(GeoMap, source_id)
        if gmap is None or gmap.source_id is not None:
            raise not_found("source", source_id)
        return _map_target(source_id, None, gmap)
    if source.kind == "map":
        gmap = s.execute(select(GeoMap).where(GeoMap.source_id == source.id)).scalars().first()
        if gmap is None:
            raise AppError("conflict", f"source {source.label or source.id} has no map", 409)
        return _map_target(source_id, source.id, gmap)
    image_ids = list(
        s.execute(select(Image.id).where(Image.source_id == source.id).order_by(Image.path)).scalars()
    )
    if not image_ids:
        raise AppError("conflict", f"source {source.label or source.folder} has no photos yet", 409)
    return _Target(source_id, "images", source.id, image_ids)


def _map_target(source_id: str, run_source_id: str | None, gmap: GeoMap) -> _Target:
    if gmap.status != READY:
        raise AppError("conflict", f"map {gmap.name} is {gmap.status}, not ready", 409)
    return _Target(source_id, "map", run_source_id, [], map_id=gmap.id)


def _targets(handle: ProjectHandle, source_ids: list[str]) -> list[_Target]:
    with handle.session() as s:
        return [_target(s, sid) for sid in dict.fromkeys(source_ids)]


def _cloud_model_name(config: ProviderConfigStore, keys: KeyStore, body: RunCreate) -> str:
    if not (body.query or "").strip():
        raise AppError("validation_error", "a cloud provider run needs a non-empty query", 422)
    if keys.get(body.provider) is None:
        raise AppError("conflict", f"no API key stored for {body.provider}", 409)
    return config.get(body.provider).model_name


def create_runs(
    handle: ProjectHandle,
    lib: LibraryHandle | None,
    keys: KeyStore,
    config: ProviderConfigStore,
    body: RunCreate,
    submit: Callable[[str, dict], Job],
) -> list[tuple[_Target, str, Job]]:
    """One run per source, each with its job queued; `(target, run_id, job)` per source."""
    if not body.model_id and not body.provider:
        raise AppError("validation_error", "a run needs a library model_id or a provider", 422)
    targets = _targets(handle, body.source_ids)  # unknown sources: 404 before anything else

    model = None
    mapping: dict = {}
    snapshot: dict = {}
    if body.model_id:
        if lib is None:
            raise library_unavailable()
        model = library.require_ready(lib, body.model_id)
        # Seeding an empty project's classes commits first, on purpose: it maps every class, so it
        # can never cause a refusal, and a project that later refuses keeps useful classes.
        mapping, unmapped = class_maps.resolve(handle, model, seed=True)
        if unmapped:
            raise AppError(
                "unmapped_classes",
                f"{len(unmapped)} of the model's classes are not mapped to project classes.",
                422,
                {"model_id": model.id, "unmapped": unmapped},
            )
        snapshot = class_maps.model_snapshot(model)
        model_name = model.name
    else:
        model_name = _cloud_model_name(config, keys, body)

    tiling = body.tiling or Tiling()
    common = {
        "kind": "local_model" if model else "cloud_provider",
        "model_id": model.id if model else None,
        "provider": None if model else body.provider,
        "model_name": model_name,
        "query": "" if model else (body.query or "").strip(),
        "conf": body.conf,
        "model_snapshot": snapshot,
        "class_map": mapping,
    }
    target_gsd = (
        body.target_gsd_cm if body.target_gsd_cm is not None else (model.train_gsd_cm if model else None)
    )
    rows: list[tuple[_Target, str, str, str]] = []
    with handle.session() as s:
        for t in targets:
            if t.kind == "images":
                row = QueryRun(
                    **common, source_id=t.run_source_id, image_ids=t.image_ids, tiling=tiling.model_dump()
                )
                job_type, key = "infer", "query_run_id"
            else:
                row = MapRun(
                    **common,
                    source_id=t.run_source_id,
                    map_id=t.map_id,
                    tile_size=tiling.tile_size,
                    overlap=tiling.overlap,
                    nms_iou=tiling.nms_iou,
                    target_gsd_cm=target_gsd,
                )
                job_type, key = "map_detect", "map_run_id"
            s.add(row)
            s.flush()
            rows.append((t, row.id, job_type, key))
    out = []
    for i, (t, run_id, job_type, key) in enumerate(rows):
        try:
            job = submit(job_type, {key: run_id})
        except Exception:
            _drop_unsubmitted(handle, rows[i:])
            raise
        with handle.session() as s:
            (s.get(QueryRun, run_id) if t.kind == "images" else s.get(MapRun, run_id)).job_id = job.id
        out.append((t, run_id, job))
    return out


def _drop_unsubmitted(handle: ProjectHandle, rows: list[tuple[_Target, str, str, str]]) -> None:
    """A submit failed: delete the runs that never got a job, so the list shows no run that will
    never start. Runs already queued keep their job and stay."""
    with handle.session() as s:
        for t, run_id, _, _ in rows:
            row = s.get(QueryRun, run_id) if t.kind == "images" else s.get(MapRun, run_id)
            if row is not None and row.job_id is None:
                s.delete(row)


# ----------------------------------------------------------------------------- list


def _labels(s: Session, source_ids: set[str], map_ids: set[str]) -> tuple[dict[str, str], dict[str, str]]:
    """Source labels (label, else folder) and map names for one page's runs only."""
    sources: dict[str, str] = {}
    if source_ids:
        q = select(Source.id, Source.label, Source.folder).where(Source.id.in_(source_ids))
        sources = {sid: label or folder for sid, label, folder in s.execute(q)}
    maps: dict[str, str] = {}
    if map_ids:
        maps = dict(s.execute(select(GeoMap.id, GeoMap.name).where(GeoMap.id.in_(map_ids))).all())
    return sources, maps


def _progress(s: Session, col, run_col, run_ids: list[str]) -> dict[str, ReviewProgress]:
    """Review progress per run from one grouped COUNT: no row is materialised."""
    if not run_ids:
        return {}
    reviewed = func.sum(case((col != "unreviewed", 1), else_=0))
    rows = s.execute(
        select(run_col, func.count(), reviewed).where(run_col.in_(run_ids)).group_by(run_col)
    ).all()
    found = {rid: ReviewProgress(total=n, reviewed=int(r or 0)) for rid, n, r in rows}
    return {rid: found.get(rid, ReviewProgress(total=0, reviewed=0)) for rid in run_ids}


def _job_states(s: Session, job_ids: list[str]) -> dict[str, str]:
    ids = [j for j in job_ids if j]
    if not ids:
        return {}
    return dict(s.execute(select(Job.id, Job.state).where(Job.id.in_(ids))).all())


def _summary(row, kind: str, label: str | None, state: str | None, review: ReviewProgress) -> RunSummary:
    snapshot = row.model_snapshot or {}
    return RunSummary(
        id=row.id,
        kind=kind,
        source_id=row.source_id,
        source_label=label,
        model_id=row.model_id,
        model_name=snapshot.get("name") or row.model_name,
        conf=row.conf,
        job_state=state,
        pinned=bool(row.pinned),
        counts=dict(row.counts or {}),
        verified_counts=dict(row.verified_counts or {}),
        review=review,
        created_at=row.created_at,
    )


def _page_query(table, source_id: str | None, after: tuple[datetime, str] | None, n: int):
    q = select(table).order_by(table.created_at.desc(), table.id.desc())
    if source_id is not None:
        if table is MapRun:  # a map's runs made before it had a source are found by the map id too
            q = q.where((MapRun.source_id == source_id) | (MapRun.map_id == source_id))
        else:
            q = q.where(QueryRun.source_id == source_id)
    if after is not None:
        q = q.where(tuple_(table.created_at, table.id) < after)
    return q.limit(n + 1)


def list_runs(
    handle: ProjectHandle, source_id: str | None, limit: int | None, cursor: str | None
) -> tuple[list[RunSummary], str | None]:
    """Both run tables, newest first (`created_at desc, id desc`), one page with a cursor.

    Each table contributes at most `limit + 1` rows, so a page reads at most twice its size.
    """
    n = clamp_limit(limit)
    c = decode_cursor(cursor, "created_at", "id")
    after = None
    if c:
        try:
            after = (datetime.fromisoformat(str(c["created_at"])), str(c["id"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
    with handle.session() as s:
        queried = [("images", r) for r in s.execute(_page_query(QueryRun, source_id, after, n)).scalars()]
        mapped = [("map", r) for r in s.execute(_page_query(MapRun, source_id, after, n)).scalars()]
        merged = sorted(queried + mapped, key=lambda kr: (kr[1].created_at, kr[1].id), reverse=True)
        page, more = merged[:n], len(merged) > n
        items = _summaries(s, page)
    next_cursor = None
    if more and page:
        last = page[-1][1]
        next_cursor = encode_cursor(created_at=last.created_at.isoformat(), id=last.id)
    return items, next_cursor


def _summaries(s: Session, page: list[tuple[str, object]]) -> list[RunSummary]:
    sources, maps = _labels(
        s,
        {r.source_id for _, r in page if r.source_id},
        {r.map_id for k, r in page if k == "map"},
    )
    q_ids = [r.id for k, r in page if k == "images"]
    m_ids = [r.id for k, r in page if k == "map"]
    progress = {
        **_progress(s, Box.review_state, Box.query_run_id, q_ids),
        **_progress(s, MapDetection.review_state, MapDetection.run_id, m_ids),
    }
    states = _job_states(s, [r.job_id for _, r in page])
    out = []
    for kind, r in page:
        label = sources.get(r.source_id) if r.source_id else None
        if label is None and kind == "map":
            label = maps.get(r.map_id)
        out.append(_summary(r, kind, label, states.get(r.job_id), progress[r.id]))
    return out


# ------------------------------------------------------------------------ one run


def _find(s: Session, run_id: str) -> tuple[str, QueryRun | MapRun]:
    row = s.get(QueryRun, run_id)
    if row is not None:
        return "images", row
    row = s.get(MapRun, run_id)
    if row is not None:
        return "map", row
    raise not_found("run", run_id)


def run_kind(handle: ProjectHandle, run_id: str) -> str:
    """`images` or `map`; 404 for an unknown run."""
    with handle.session() as s:
        return _find(s, run_id)[0]


def set_pinned(handle: ProjectHandle, run_id: str, pinned: bool) -> RunSummary:
    """Pin or unpin a run. Pinning unpins the other runs of its source in the same transaction; a
    map run's source is its map, so runs made before the map had a source are unpinned too."""
    with handle.session() as s:
        kind, row = _find(s, run_id)
        if pinned:
            if kind == "map":
                others = update(MapRun).where(MapRun.map_id == row.map_id, MapRun.id != row.id)
                s.execute(others.values(pinned=False))
            elif row.source_id is not None:
                others = update(QueryRun).where(QueryRun.source_id == row.source_id, QueryRun.id != row.id)
                s.execute(others.values(pinned=False))
        row.pinned = pinned
        s.flush()
        [summary] = _summaries(s, [(kind, row)])
    return summary


# ------------------------------------------------------------------------- recount


def recount(handle: ProjectHandle, run_id: str) -> dict:
    """Rebuild one run's counts from its rows (the repair tool for drifted counts)."""
    with handle.session() as s:
        kind, row = _find(s, run_id)
        if kind == "images":
            recount_query_run(s, row)
        else:
            recount_map_run(s, row, areas_for_map(s, s.get(GeoMap, row.map_id)))
        return {"run_id": run_id, "kind": kind, "counts": dict(row.counts or {})}


@register_job_type("recount")
def run_recount(ctx: JobContext) -> dict:
    ctx.progress(0.0, "recounting")
    result = recount(ctx.project, ctx.params["run_id"])
    ctx.progress(1.0, "recounted")
    ctx.publish("runs.changed", {"run_ids": [result["run_id"]]})
    return result
