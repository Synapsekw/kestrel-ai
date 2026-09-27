"""An accepted defect detection on a map IS a finding (map workspace spec §9.3; F §8.5).

`MapDetection.finding_id` (unique) links a detection to the one finding it became. Every review write
calls `Link.after_change` for each detection it changed, in the same transaction as the review and
its count increment, so the two can never disagree after a commit:

- ground truth on a defect type, no finding yet -> a finding: `reviewed` with the model and its
  confidence, or `open` by `human` for a person-drawn box;
- ground truth on another defect type -> the finding's type follows;
- rejected, unreviewed, or an object type -> the finding is deleted. The caller refuses that with 409
  `finding_would_be_deleted` unless it was confirmed (`would_delete` / `refuse`, checked before
  anything changes).

A map without a georeference gets no finding: its anchor could not be placed (spec §14).
`on_finding_deleting` is the other direction: F deletes a map finding, and its detection is rejected.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Finding, GeoMap, MapDetection, MapRun, ProjectType
from app.detect.counts import VERIFIED_STATES
from app.errors import AppError
from app.findings import annotations
from app.findings import service as findings
from app.findings.anchors import AnchorIn
from app.findings.numbers import format_number
from app.maps.georef import Georef, box_corners

log = logging.getLogger(__name__)
MAX_LISTED = 100


def is_defect(s: Session, class_id: str) -> bool:
    row = s.get(ProjectType, class_id)
    return row is not None and row.kind == "defect"


def _finding(s: Session, d: MapDetection) -> Finding | None:
    return s.get(Finding, d.finding_id) if d.finding_id else None


def would_delete(s: Session, d: MapDetection, class_id: str, state: str) -> bool:
    """Would moving `d` to (class_id, state) delete its finding?"""
    if _finding(s, d) is None:
        return False
    return state not in VERIFIED_STATES or not is_defect(s, class_id)


def refuse(s: Session, finding_ids: list[str]) -> AppError:
    numbers = sorted(
        s.execute(select(Finding.number).where(Finding.id.in_(finding_ids[:MAX_LISTED]))).scalars()
    )
    named = ", ".join(format_number(n) for n in numbers[:5]) + (" and more" if len(finding_ids) > 5 else "")
    n = len(finding_ids)
    return AppError(
        "finding_would_be_deleted",
        f"{named} would be deleted with {'this detection' if n == 1 else 'these detections'}. "
        "Confirm to delete, or keep the detection accepted.",
        409,
        {"finding_id": finding_ids[0], "finding_ids": finding_ids[:MAX_LISTED], "count": n},
    )


def _georef(gmap: GeoMap | None) -> Georef | None:
    if gmap is None or not gmap.geotransform or not gmap.crs_wkt:
        return None
    try:
        return Georef(gmap.geotransform, gmap.crs_wkt)
    except Exception:  # an unreadable CRS: no anchor can be placed, the review still goes ahead
        log.warning("map %s has an unreadable georeference; no findings from its detections", gmap.id)
        return None


def created_by(run: MapRun, d: MapDetection) -> str:
    """`human` for a person-drawn box, else `model:<library model id>` (a provider's name stands in)."""
    if d.provenance_kind == "person":
        return "human"
    return f"model:{run.model_id or run.provider or 'unknown'}"


class Link:
    """The detection -> finding rule for one review write on one run."""

    def __init__(self, s: Session, handle, run: MapRun, *, batch: bool = True):
        self.s, self.handle, self.run, self.batch = s, handle, run, batch
        self.georef = _georef(s.get(GeoMap, run.map_id))
        self.created: list[str] = []
        self.deleted: list[str] = []

    def after_change(self, d: MapDetection) -> None:
        """`d` already carries its new class and state."""
        s = self.s
        f = _finding(s, d)
        if f is None:
            d.finding_id = None  # a link to a finding that is gone
        ground_truth = d.review_state in VERIFIED_STATES
        defect = is_defect(s, d.class_id)
        if f is None:
            if ground_truth and defect and self.georef is not None:
                self._create(d)
            return
        if not (ground_truth and defect):
            d.finding_id = None
            s.flush()  # unlink first: F's delete hook must not reject this detection a second time
            self.deleted.append(
                findings.delete_in_session(
                    s, project_id=self.handle.id, finding_id=f.id, delete_annotation=False
                )
            )
            return
        if f.type_id != d.class_id:
            findings.patch_in_session(
                s,
                project_id=self.handle.id,
                catalogue=self.handle.catalogue,
                finding_id=f.id,
                fields={"type_id": d.class_id},
            )

    def _create(self, d: MapDetection) -> None:
        corners = [self.georef.pixel_to_native(px, py) for px, py in box_corners(d.x, d.y, d.w, d.h, d.angle)]
        ring = [[x, y] for x, y in corners] + [[corners[0][0], corners[0][1]]]
        lon, lat = self.georef.pixel_to_wgs84(d.x + d.w / 2, d.y + d.h / 2)
        person = d.provenance_kind == "person"
        row = findings.create_in_session(
            self.s,
            project_id=self.handle.id,
            catalogue=self.handle.catalogue,
            type_id=d.class_id,
            anchor=AnchorIn(
                kind="map", map_id=self.run.map_id, geometry={"type": "Polygon", "coordinates": [ring]}
            ),
            status="open" if person else "reviewed",
            created_by=created_by(self.run, d),
            confidence=None if person else d.confidence,
            lon=lon,
            lat=lat,
            record_activity=not self.batch,
        )
        d.finding_id = row.id
        self.created.append(row.id)

    def finish(self) -> None:
        """One `detections.accepted` activity row per review request (F §8.5)."""
        if self.batch:
            annotations.record_accepted(self.s, self.created)


def on_finding_deleting(s: Session, finding_id: str) -> None:
    """F is deleting a map finding: the detection it came from becomes `rejected`, with its run's
    counts, in the same transaction (spec §9.3). A review that deletes the finding itself unlinks
    first, so this finds nothing then."""
    d = s.execute(select(MapDetection).where(MapDetection.finding_id == finding_id)).scalar_one_or_none()
    if d is None:
        return
    d.finding_id = None
    if d.review_state != "rejected":
        from app.detect.review import _RunCounts  # review imports this module

        run = s.get(MapRun, d.run_id)
        tally = _RunCounts(s, run)
        old = (d.class_id, d.review_state)
        d.review_state = "rejected"
        tally.apply(d, old, (d.class_id, "rejected"))
        tally.save()
    s.flush()
