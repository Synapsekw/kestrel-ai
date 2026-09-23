"""The numbers behind the Analytics screen (spec 2026-09-23 section 9, plan 2 unit A).

Every count here was written onto a run row by the counting rules (`app/detect/counts.py`): a
request reads run rows, sources and maps, and never loads a detection. The one exception is a
run's review progress, which is a grouped COUNT served by the `(run_id, review_state)` index: a
handful of rows back, whatever the size of the run.

Which run speaks for a source:
- a map source: a pinned run, else the survey timeline's comparison rule (newest run on the basis);
- a photo source: a pinned run, else the newest.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Box, GeoMap, Job, MapDetection, MapRun, QueryRun, SiteArea, Source
from app.detect.areas import project_area
from app.errors import not_found
from app.maps import timeline
from app.projects.service import ProjectHandle

UNREVIEWED = "unreviewed"


@dataclass
class ClassCount:
    class_id: str
    name: str
    colour: str
    total: int
    verified: int


@dataclass
class Review:
    total: int = 0
    reviewed: int = 0


@dataclass
class RunSummary:
    id: str
    kind: str  # images | map
    source_id: str | None
    source_label: str | None
    model_id: str | None
    model_name: str | None
    conf: float
    job_state: str | None
    pinned: bool
    counts: dict[str, int]
    verified_counts: dict[str, int]
    review: Review
    created_at: datetime


@dataclass
class SourceView:
    """A `Source` row with the map it owns, for the response's `source`."""

    row: Source
    map_id: str | None


@dataclass
class SourceAnalytics:
    source: SourceView
    unit: str  # objects | detections
    image_count: int | None
    run: RunSummary | None
    classes: list[ClassCount]
    review: Review


@dataclass
class AreaCell:
    partial: bool
    counts: dict[str, dict[str, int]] = field(default_factory=dict)


@dataclass
class AreaSurvey:
    map_id: str
    map_name: str
    captured_on: date | None
    state: str
    per_area: dict[str, AreaCell]


@dataclass
class AreaAnalytics:
    areas: list[tuple[str, str]]  # (id, name)
    surveys: list[AreaSurvey]


@dataclass
class PhotoBatch:
    source: SourceView
    run: RunSummary | None
    classes: list[ClassCount]


# --- shared pieces -------------------------------------------------------------------------------


def class_counts(project_classes: list[dict], counts: dict, verified: dict) -> list[ClassCount]:
    """One row per class with a count, in the project's class order; a class since deleted from
    the project still shows, under its id, so the rows always add up to the run's total."""
    rows: list[ClassCount] = []
    known = set()
    for c in project_classes:
        known.add(c["id"])
        total, ver = int(counts.get(c["id"], 0)), int(verified.get(c["id"], 0))
        if total or ver:
            rows.append(ClassCount(c["id"], c["name"], c["colour"], total, ver))
    for class_id in sorted(set(counts) | set(verified)):
        if class_id not in known:
            total, ver = int(counts.get(class_id, 0)), int(verified.get(class_id, 0))
            rows.append(ClassCount(class_id, class_id, "#808080", total, ver))
    return rows


def resolve_basis(runs: list[MapRun], model_id: str | None, conf: float | None) -> timeline.Basis | None:
    """The timeline's basis, overridden by an explicit model and/or confidence (as the timeline
    endpoint does)."""
    basis = timeline.choose_basis(runs)
    if basis and (model_id is not None or conf is not None):
        wanted = model_id if model_id is not None else basis.model_id
        named = next((r for r in runs if r.model_id == wanted), None)
        basis = timeline.Basis(
            model_id=wanted,
            model_name=named.model_name if named else basis.model_name,
            conf=conf if conf is not None else basis.conf,
        )
    return basis


def _pinned_first(runs_by_map: dict[str, list[MapRun]]) -> dict[str, list[MapRun]]:
    """A pinned run is the only candidate for its map: the operator's choice beats the rule."""
    out: dict[str, list[MapRun]] = {}
    for map_id, runs in runs_by_map.items():
        pinned = [r for r in runs if r.pinned]
        out[map_id] = [max(pinned, key=lambda r: r.created_at)] if pinned else runs
    return out


def _map_rows(s: Session) -> tuple[list[GeoMap], dict[str, list[MapRun]]]:
    """Every map and its runs: tens of rows, never a detection."""
    maps = list(s.execute(select(GeoMap)).scalars())
    by_map: dict[str, list[MapRun]] = {}
    for r in s.execute(select(MapRun)).scalars():
        by_map.setdefault(r.map_id, []).append(r)
    return maps, by_map


def _surveys(
    maps: list[GeoMap], runs_by_map: dict[str, list[MapRun]], model_id: str | None, conf: float | None
) -> list[timeline.Survey]:
    all_runs = [r for rs in runs_by_map.values() for r in rs]
    basis = resolve_basis(all_runs, model_id, conf)
    return timeline.build_timeline(maps, _pinned_first(runs_by_map), basis)


def _job_states(s: Session, job_ids: list[str | None]) -> dict[str, str]:
    ids = [j for j in job_ids if j]
    if not ids:
        return {}
    return dict(s.execute(select(Job.id, Job.state).where(Job.id.in_(ids))).all())


def _review_by_run(s: Session, run_col, state_col, run_ids: list[str]) -> dict[str, Review]:
    """Review progress per run from one grouped COUNT.

    For map runs the covering index ix_map_detection_run_state serves it without reading a row.
    For photo runs ix_box_query_run finds the boxes but each one is read for its review_state:
    O(boxes in the chosen runs). A box(query_run_id, review_state) index, or reviewed counts on
    the run row, would remove that (a later schema change)."""
    out = {rid: Review() for rid in run_ids}
    if not run_ids:
        return out
    rows = s.execute(
        select(run_col, state_col, func.count()).where(run_col.in_(run_ids)).group_by(run_col, state_col)
    )
    for run_id, state, n in rows:
        out[run_id].total += n
        if state != UNREVIEWED:
            out[run_id].reviewed += n
    return out


def _summary(
    run: MapRun | QueryRun,
    kind: str,
    source_label: str | None,
    job_state: str | None,
    review: Review,
) -> RunSummary:
    snapshot = run.model_snapshot or {}
    return RunSummary(
        id=run.id,
        kind=kind,
        source_id=run.source_id,
        source_label=source_label,
        model_id=run.model_id,
        model_name=snapshot.get("name") or run.model_name,
        conf=run.conf,
        job_state=job_state,
        pinned=bool(run.pinned),
        counts={str(k): int(v) for k, v in (run.counts or {}).items()},
        verified_counts={str(k): int(v) for k, v in (run.verified_counts or {}).items()},
        review=review,
        created_at=run.created_at,
    )


def _label(source: Source, gmap: GeoMap | None = None) -> str:
    if source.label:
        return source.label
    if gmap is not None:
        return gmap.name
    return source.folder


def _photo_run(runs: list[QueryRun]) -> QueryRun | None:
    pinned = [r for r in runs if r.pinned]
    return max(pinned or runs, key=lambda r: (r.created_at, r.id), default=None)


def _photo_summaries(s: Session, chosen: dict[str, tuple[Source, QueryRun]]) -> dict[str, RunSummary]:
    """source id -> the summary of its chosen photo run, from one grouped COUNT over all of them."""
    runs = [run for _, run in chosen.values()]
    reviews = _review_by_run(s, Box.query_run_id, Box.review_state, [r.id for r in runs])
    states = _job_states(s, [r.job_id for r in runs])
    return {
        sid: _summary(run, "images", _label(src), states.get(run.job_id or ""), reviews[run.id])
        for sid, (src, run) in chosen.items()
    }


# --- the three reads -----------------------------------------------------------------------------


def source(handle: ProjectHandle, source_id: str) -> SourceAnalytics:
    """One source's class counts from the run that speaks for it."""
    with handle.session() as s:
        src = s.get(Source, source_id)
        if src is None:
            raise not_found("source", source_id)
        project_classes = handle.row(s).classes
        gmap = s.execute(select(GeoMap).where(GeoMap.source_id == source_id).limit(1)).scalar_one_or_none()
        if src.kind == "map":
            summary = _map_source_summary(s, src, gmap)
            unit, image_count = "objects", None
        else:
            candidates = list(s.execute(select(QueryRun).where(QueryRun.source_id == source_id)).scalars())
            run = _photo_run(candidates)
            summary = _photo_summaries(s, {source_id: (src, run)})[source_id] if run else None
            unit, image_count = "detections", src.image_count
        classes = class_counts(project_classes, summary.counts, summary.verified_counts) if summary else []
        view = SourceView(src, gmap.id if gmap else None)
        s.expunge_all()
    return SourceAnalytics(
        source=view,
        unit=unit,
        image_count=image_count,
        run=summary,
        classes=classes,
        review=summary.review if summary else Review(),
    )


def _map_source_summary(s: Session, src: Source, gmap: GeoMap | None) -> RunSummary | None:
    if gmap is None:
        return None
    maps, runs_by_map = _map_rows(s)
    survey = next((x for x in _surveys(maps, runs_by_map, None, None) if x.map_id == gmap.id), None)
    if survey is None or survey.run_id is None:
        return None
    run = next(r for r in runs_by_map[gmap.id] if r.id == survey.run_id)
    review = _review_by_run(s, MapDetection.run_id, MapDetection.review_state, [run.id])[run.id]
    state = _job_states(s, [run.job_id]).get(run.job_id or "")
    return _summary(run, "map", _label(src, gmap), state, review)


def areas(
    handle: ProjectHandle, model_id: str | None = None, conf: float | None = None, verified_only: bool = False
) -> AreaAnalytics:
    """Per survey, in timeline order: each site area's counts from the run that speaks for the
    survey, and whether the area is only partly on that map. Reads run rows only.

    `verified_only` is accepted for symmetry with the timeline; each cell carries both the total and
    the verified count, and the screen shows the one it wants."""
    del verified_only  # which run speaks for a survey does not depend on it
    with handle.session() as s:
        site_areas = list(s.execute(select(SiteArea).order_by(SiteArea.created_at, SiteArea.id)).scalars())
        maps, runs_by_map = _map_rows(s)
        by_id = {m.id: m for m in maps}
        runs = {r.id: r for rs in runs_by_map.values() for r in rs}
        surveys: list[AreaSurvey] = []
        for survey in _surveys(maps, runs_by_map, model_id, conf):
            gmap = by_id[survey.map_id]
            area_counts = (runs[survey.run_id].area_counts or {}) if survey.run_id else {}
            per_area: dict[str, AreaCell] = {}
            for area in site_areas:
                projected = project_area(gmap, area)
                if projected is None:
                    continue
                counts = {
                    str(c): {"total": int(v.get("total", 0)), "verified": int(v.get("verified", 0))}
                    for c, v in (area_counts.get(area.id) or {}).items()
                }
                per_area[area.id] = AreaCell(partial=projected.partial, counts=counts)
            surveys.append(
                AreaSurvey(
                    map_id=survey.map_id,
                    map_name=survey.map_name,
                    captured_on=survey.captured_on,
                    state=survey.state,
                    per_area=per_area,
                )
            )
        refs = [(a.id, a.name) for a in site_areas]
    return AreaAnalytics(areas=refs, surveys=surveys)


def photo_batches(handle: ProjectHandle) -> list[PhotoBatch]:
    """One row per photo source, oldest survey first: detections, never objects."""
    with handle.session() as s:
        project_classes = handle.row(s).classes
        sources = list(s.execute(select(Source).where(Source.kind == "images")).scalars())
        sources.sort(key=lambda r: (r.captured_on is None, r.captured_on or date.min, r.created_at, r.id))
        runs_by_source: dict[str, list[QueryRun]] = {}
        ids = [r.id for r in sources]
        if ids:
            for run in s.execute(select(QueryRun).where(QueryRun.source_id.in_(ids))).scalars():
                runs_by_source.setdefault(run.source_id, []).append(run)
        chosen = {}
        for src in sources:
            run = _photo_run(runs_by_source.get(src.id, []))
            if run is not None:
                chosen[src.id] = (src, run)
        summaries = _photo_summaries(s, chosen)
        out = []
        for src in sources:
            summary = summaries.get(src.id)
            classes = (
                class_counts(project_classes, summary.counts, summary.verified_counts) if summary else []
            )
            out.append(PhotoBatch(source=SourceView(src, None), run=summary, classes=classes))
        s.expunge_all()
    return out
