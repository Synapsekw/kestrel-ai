"""Object counts over surveys, per site area and per photo batch, for the comparison and
object-counts sections (reports spec §3, §7.2; plan R9-M Rulings 13-15).

Every number was written onto a run row elsewhere (ADR 2026-09-23-counts-live-on-run-rows); this
module reads run rows, maps, site areas and sources only. Which run speaks for a survey is the
survey timeline's rule (`app.maps.timeline`), so a change of model never reads as a change on the
ground. Map counts are objects; photo counts are detections, never objects."""

from __future__ import annotations

from dataclasses import dataclass

from app.detect import analytics
from app.maps import service as maps_service
from app.maps import timeline
from app.reports.figures.map_geo import day_text

OBJECTS = "objects"
DETECTIONS = "detections"
PHOTO_NOTE = "Photo counts are detections, not objects: one machine seen in three photos counts three times."
UNKNOWN_COLOUR = "#808080"


@dataclass(frozen=True)
class ClassRef:
    id: str
    name: str
    colour: str


@dataclass(frozen=True)
class CountsData:
    surveys: list[timeline.Survey]
    classes: list[ClassRef]  # the project's classes, in its order


def load(handle) -> CountsData:
    maps, runs_by_map = maps_service.timeline_rows(handle)
    # A survey is a ready map with a WGS84 footprint (Ruling 10); `status == "ready"` alone is not
    # enough, since georeferencing can fail on an otherwise-ready import (jobs_import.py).
    maps = [m for m in maps if m.status == "ready" and m.bounds_wgs84 is not None]
    runs_by_map = {m.id: runs_by_map.get(m.id, []) for m in maps}
    basis = timeline.choose_basis([r for rs in runs_by_map.values() for r in rs])
    surveys = timeline.build_timeline(maps, runs_by_map, basis)
    with handle.session() as s:
        classes = [ClassRef(c["id"], c["name"], c["colour"]) for c in handle.row(s).classes]
    return CountsData(surveys=surveys, classes=classes)


def chosen_classes(data: CountsData, type_ids: list[str] | None) -> list[ClassRef]:
    present: set[str] = set()
    for sv in data.surveys:
        present |= {k for k, v in sv.counts.items() if v} | {k for k, v in sv.verified_counts.items() if v}
    known = {c.id for c in data.classes}
    out = [c for c in data.classes if c.id in present]
    out += [ClassRef(i, i, UNKNOWN_COLOUR) for i in sorted(present - known)]
    return [c for c in out if not type_ids or c.id in type_ids]


def survey_label(sv: timeline.Survey) -> str:
    return day_text(sv.captured_on) + (" (import date)" if sv.date_is_import_date else "")


def _cell(sv: timeline.Survey, class_id: str, verified_only: bool) -> str:
    if sv.state == "not_counted":
        return "—"
    total, ver = sv.counts.get(class_id, 0), sv.verified_counts.get(class_id, 0)
    text = str(ver) if verified_only else f"{total} ({ver})"
    return text + (" *" if sv.state == "not_comparable" else "")


def class_table(
    data: CountsData, classes: list[ClassRef], verified_only: bool
) -> tuple[list[str], list[list[str]]]:
    head = ["Class", *[survey_label(sv) for sv in data.surveys]]
    rows = [[c.name, *[_cell(sv, c.id, verified_only) for sv in data.surveys]] for c in classes]
    return head, rows


def not_comparable_notes(data: CountsData) -> list[str]:
    return [
        f"* {survey_label(sv)}: {sv.reason}; not compared."
        for sv in data.surveys
        if sv.state == "not_comparable"
    ]


def chart_series(
    data: CountsData, classes: list[ClassRef], verified_only: bool, top: int = 8
) -> tuple[list[str], list[tuple[str, str, list[int | None]]]]:
    def value(sv, cid):
        if sv.state != "ok":
            return None
        return (sv.verified_counts if verified_only else sv.counts).get(cid, 0)

    newest = next((sv for sv in reversed(data.surveys) if sv.state == "ok"), None)
    ranked = sorted(classes, key=lambda c: (-(value(newest, c.id) or 0) if newest else 0, c.name))[:top]
    labels = [survey_label(sv) for sv in data.surveys]
    return labels, [(c.name, c.colour, [value(sv, c.id) for sv in data.surveys]) for c in ranked]


def area_table(
    handle, classes: list[ClassRef], verified_only: bool
) -> tuple[str | None, list[str], list[list[str]]]:
    result = analytics.areas(handle)
    newest = next((sv for sv in reversed(result.surveys) if sv.state != "not_counted"), None)
    head = ["Area", "Class", "Verified"] if verified_only else ["Area", "Class", "Total", "Verified"]
    if newest is None:
        return None, head, []
    rows = []
    for area_id, name in result.areas:
        cell = newest.per_area.get(area_id)
        if cell is None:
            continue
        label = name + (" (partly on this map)" if cell.partial else "")
        for c in classes:
            n = cell.counts.get(c.id)
            if not n:
                continue
            nums = [str(n["verified"])] if verified_only else [str(n["total"]), str(n["verified"])]
            rows.append([label, c.name, *nums])
    return f"{newest.map_name} · {day_text(newest.captured_on)}", head, rows


def photo_table(handle, type_ids: list[str] | None, verified_only: bool) -> tuple[list[str], list[list[str]]]:
    """One row per batch and class: detections, never objects. With `verified_only` the Detections
    column is dropped (as `area_table` drops Total)."""
    head = ["Photo batch", "Captured", "Class", *([] if verified_only else ["Detections"]), "Verified"]
    rows = []
    for b in analytics.photo_batches(handle):
        src = b.source.row
        label = src.label or src.site or src.folder
        when = day_text(src.captured_on) if src.captured_on else "—"
        if b.run is None:
            rows.append([label, when, "not counted", *([""] * (len(head) - 3))])
            continue
        for cc in b.classes:
            if type_ids and cc.class_id not in type_ids:
                continue
            nums = [str(cc.verified)] if verified_only else [str(cc.total), str(cc.verified)]
            rows.append([label, when, cc.name, *nums])
    return head, rows
