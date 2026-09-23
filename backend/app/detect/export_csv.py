"""The detection numbers as a CSV (spec 2026-09-23 section 10, plan 2 unit E).

`gather` reads what the Analytics screen reads - run rows, sources, maps and site areas, never a
detection - into one `SourceReport` per source; the CSV (`rows` / `write`) and the PDF report
(`export_pdf`) are both written from it, so the two can never disagree.

One CSV row per source x class x site area. The area column is empty for the whole source. A map
source has a row for every site area on that map and every class the source counted, zeros
included, so a spreadsheet pivot sees every area. Photo sources report detections (the same object
can appear in several photos), maps report objects: the `unit` column says which.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import select

from app.db.models import GeoMap, MapRun, QueryRun, SiteArea, Source
from app.detect import analytics
from app.detect.analytics import ClassCount, Review, RunSummary
from app.detect.areas import project_area
from app.projects.service import ProjectHandle

COLUMNS = [
    "survey_date",
    "source",
    "source_kind",
    "unit",
    "model",
    "confidence",
    "class",
    "area",
    "total",
    "verified",
]


@dataclass
class AreaReport:
    area_id: str
    name: str
    partial: bool  # the area is only partly on the map
    classes: list[ClassCount]


@dataclass
class SourceReport:
    source_id: str
    label: str
    kind: str  # images | map
    unit: str  # objects | detections
    survey_date: date | None
    image_count: int | None
    map_id: str | None
    run: RunSummary | None
    model_origin: str | None  # trained | imported | starter, from the run's model snapshot
    classes: list[ClassCount]
    review: Review
    areas: list[AreaReport] = field(default_factory=list)


def _survey_order(src: Source) -> tuple:
    """Oldest survey first; a source without a date goes last."""
    return (src.captured_on is None, src.captured_on or date.max, src.created_at, src.id)


def _area_classes(
    source_classes: list[ClassCount], cells: dict, project_classes: list[dict]
) -> list[ClassCount]:
    """Every class the source counted, with this area's numbers (zero when none fell inside), plus
    any class only the area has."""
    out = []
    seen = set()
    for c in source_classes:
        cell = cells.get(c.class_id) or {}
        out.append(
            ClassCount(c.class_id, c.name, c.colour, int(cell.get("total", 0)), int(cell.get("verified", 0)))
        )
        seen.add(c.class_id)
    extra = {k: v for k, v in cells.items() if k not in seen}
    if extra:
        totals = {k: int(v.get("total", 0)) for k, v in extra.items()}
        verified = {k: int(v.get("verified", 0)) for k, v in extra.items()}
        out += analytics.class_counts(project_classes, totals, verified)
    return out


def gather(handle: ProjectHandle, source_id: str | None = None) -> list[SourceReport]:
    """One report per source (or just `source_id`), oldest survey first. Reads rows only."""
    with handle.session() as s:
        query = select(Source)
        if source_id is not None:
            query = query.where(Source.id == source_id)
        sources = sorted(s.execute(query).scalars(), key=_survey_order)
        project_classes = list(handle.row(s).classes)
        site_areas = list(s.execute(select(SiteArea).order_by(SiteArea.created_at, SiteArea.id)).scalars())
        s.expunge_all()

    reports: list[SourceReport] = []
    for src in sources:
        view = analytics.source(handle, src.id)
        run = view.run
        origin: str | None = None
        areas: list[AreaReport] = []
        survey_date = src.captured_on
        with handle.session() as s:
            gmap = s.get(GeoMap, view.source.map_id) if view.source.map_id else None
            if gmap is not None and survey_date is None:
                survey_date = gmap.captured_on
            if run is not None:
                row = s.get(MapRun if run.kind == "map" else QueryRun, run.id)
                origin = (row.model_snapshot or {}).get("origin") if row is not None else None
                if run.kind == "map" and row is not None and gmap is not None:
                    area_counts = row.area_counts or {}
                    for area in site_areas:
                        projected = project_area(gmap, area)
                        if projected is None:
                            continue
                        areas.append(
                            AreaReport(
                                area_id=area.id,
                                name=area.name,
                                partial=projected.partial,
                                classes=_area_classes(
                                    view.classes, area_counts.get(area.id) or {}, project_classes
                                ),
                            )
                        )
        reports.append(
            SourceReport(
                source_id=src.id,
                label=analytics._label(src, gmap) if gmap is not None else analytics._label(src),
                kind=src.kind,
                unit=view.unit,
                survey_date=survey_date,
                image_count=view.image_count,
                map_id=view.source.map_id,
                run=run,
                model_origin=origin,
                classes=view.classes,
                review=view.review,
                areas=areas,
            )
        )
    return reports


def rows(reports: list[SourceReport]) -> list[dict]:
    """The CSV rows; a source without a run has none."""
    out: list[dict] = []
    for r in reports:
        if r.run is None:
            continue
        base = {
            "survey_date": r.survey_date.isoformat() if r.survey_date else "",
            "source": r.label,
            "source_kind": r.kind,
            "unit": r.unit,
            "model": r.run.model_name or "",
            "confidence": r.run.conf,
        }
        for area_name, classes in [("", r.classes)] + [(a.name, a.classes) for a in r.areas]:
            for c in classes:
                out.append(
                    {**base, "class": c.name, "area": area_name, "total": c.total, "verified": c.verified}
                )
    return out


def write(path: Path, reports: list[SourceReport]) -> None:
    # utf-8-sig: Excel opens a BOM-marked file as UTF-8, so a non-ASCII site or class name survives.
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows(reports))
