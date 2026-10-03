"""The filter and sort vocabulary shared by `GET /images` and `GET /images/index` (image inspection
spec §7.1, §14). `image` joins `image_summary` (an absent row reads as zeros) and one GROUP BY over
image findings; severity and status filters hold on the same finding row."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import case, exists, func, or_, select

from app.asset_review.effective import effective_status
from app.db.models import IMAGE_REVIEW_STATUSES, Box, Finding, Image, ImageSummary
from app.errors import AppError

STATUSES = ("open", "reviewed", "closed")
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
# I-C0's `imageSeverity` / `imageFindingStatus` patterns, verbatim.
SEVERITY_PATTERN = r"^[1-9](,[1-9])*$"
STATUS_PATTERN = r"^(open|reviewed|closed)(,(open|reviewed|closed))*$"
# C0's `imageReviewStatus` pattern, verbatim.
REVIEW_PATTERN = r"^(finding|none|uncertain|not_assessed)(,(finding|none|uncertain|not_assessed))*$"


@dataclass
class ImageFilters:
    source_id: str | None = None
    group_key: str | None = None
    search: str | None = None
    labeled: bool | None = None
    unlabeled: bool | None = None
    has_pending: bool | None = None
    has_suggestions: bool | None = None
    reviewed: bool | None = None
    has_findings: bool | None = None
    severity: list[str] | None = None  # "1".."9" (I-C0 `imageSeverity`)
    finding_status: list[str] | None = None
    type_ids: list[str] | None = None
    review_status: list[str] | None = None  # photo review statuses (asset findings spec §5.4)


def parse_csv(value: str | None) -> list[str] | None:
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    return parts or None


def _invalid(message: str) -> AppError:
    return AppError("validation_error", message, 422)


def _levels(values: list[str]) -> list[int]:
    """The route's `pattern` already refuses bad input; this guards direct callers (BP's batch scope)."""
    for v in values:
        if not (len(v) == 1 and "1" <= v <= "9"):
            raise _invalid(f"severity {v!r} is not a level 1-9")
    return [int(v) for v in values]


def _statuses(values: list[str] | None) -> list[str] | None:
    for v in values or []:
        if v not in STATUSES:
            raise _invalid(f"finding_status {v!r} is not one of {', '.join(STATUSES)}")
    return values


@dataclass(frozen=True)
class Stats:
    fs: object
    annotation_count: object
    pending_count: object
    max_pending_conf: object
    finding_count: object
    worst_severity: object
    labeled: object
    reviewed: object


def stats(f: ImageFilters) -> Stats:
    """Finding aggregates count findings that are not closed (I-C0 ruling 5), whatever the filters."""
    fs = (
        select(
            Finding.image_id.label("image_id"),
            func.count().label("n"),
            func.max(Finding.severity).label("worst"),
        )
        .where(Finding.anchor_kind == "image", Finding.image_id.is_not(None), Finding.status != "closed")
        .group_by(Finding.image_id)
        .subquery("fstats")
    )
    annotations = func.coalesce(ImageSummary.annotation_count, 0)
    pending = func.coalesce(ImageSummary.pending_count, 0)
    labeled = or_(annotations > 0, Image.marked_empty)
    return Stats(
        fs=fs,
        annotation_count=annotations,
        pending_count=pending,
        max_pending_conf=ImageSummary.max_pending_conf,
        finding_count=func.coalesce(fs.c.n, 0),
        worst_severity=fs.c.worst,
        labeled=labeled,
        reviewed=(pending == 0) & labeled,
    )


def join_stats(q, st: Stats):
    return q.outerjoin(ImageSummary, ImageSummary.image_id == Image.id).outerjoin(
        st.fs, st.fs.c.image_id == Image.id
    )


def _bool(q, cond, value: bool | None):
    return q if value is None else q.where(cond if value else ~cond)


def review_condition(values: list[str]):
    """Photos whose effective review status is one of `values` (asset findings spec §5.4): the
    `image_review` row's status, else `none` when marked empty, else `not_assessed`. The same
    expression `GET /images/{id}/review` answers with (coordinator ruling for D1)."""
    for v in values:
        if v not in IMAGE_REVIEW_STATUSES:
            raise _invalid(f"review_status {v!r} is not one of {', '.join(IMAGE_REVIEW_STATUSES)}")
    return effective_status().in_(values)


def where(q, f: ImageFilters, st: Stats):
    if f.source_id:
        q = q.where(Image.source_id == f.source_id)
    if f.group_key:
        q = q.where(Image.group_key == f.group_key)
    if f.search:
        q = q.where(Image.path.icontains(f.search, autoescape=True))
    q = _bool(q, st.labeled, f.labeled)
    q = _bool(q, st.labeled, None if f.unlabeled is None else not f.unlabeled)
    q = _bool(q, st.pending_count > 0, f.has_pending)
    q = _bool(q, st.pending_count > 0, f.has_suggestions)
    q = _bool(q, st.reviewed, f.reviewed)
    q = _bool(q, st.finding_count > 0, f.has_findings)
    statuses = _statuses(f.finding_status)
    if f.severity or statuses:
        # Severity and status must hold on the same finding (spec §7.1). Without a status, severity
        # matches the findings the counts show: those that are not closed (I-BX Ruling 3).
        conds = [Finding.anchor_kind == "image", Finding.image_id == Image.id]
        conds.append(Finding.status.in_(statuses) if statuses else Finding.status != "closed")
        if f.severity:
            conds.append(Finding.severity.in_(_levels(f.severity)))
        q = q.where(exists().where(*conds))
    if f.type_ids:
        q = q.where(
            exists().where(
                Box.image_id == Image.id, Box.class_id.in_(f.type_ids), Box.review_state != "rejected"
            )
        )
    if f.review_status:
        q = q.where(review_condition(f.review_status))
    return q


SORT_NAMES = (
    "path",
    "source_id",
    "group_key",
    "labeled",
    "box_count",
    "pending_count",
    "max_pending_confidence",
    "capture_time",
    "created_at",
    "worst_severity",
)


def sort_expression(name: str, st: Stats):
    return {
        "path": Image.path,
        "source_id": Image.source_id,
        "group_key": Image.group_key,
        "created_at": Image.created_at,
        "capture_time": func.coalesce(Image.capture_time, EPOCH),
        "labeled": case((st.labeled, 1), else_=0),
        "box_count": st.annotation_count,
        "pending_count": st.pending_count,
        "max_pending_confidence": func.coalesce(st.max_pending_conf, -1.0),
        "worst_severity": func.coalesce(st.worst_severity, 0),
    }[name]
