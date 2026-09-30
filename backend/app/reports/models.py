"""Reports' tables in project.db (spec 2026-09-26-reports section 6.1, migration 0014; plan R0).

R0 owns the mapping. R1 writes `report` and `report_asset`; R5 writes `report_version` and
`report_version_finding`. A version row is inserted `rendering` with no number and gets its number
on promote (plan R5 ruling 1), so `number` is nullable and unique per report among numbered rows.
`label` and `error` live in `stats` (plan R5 rulings 4 and 10).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Index, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, new_id, utcnow

# Frozen as text in migration 0014.
REPORT_VERSION_STATE_CHECK = "state IN ('rendering', 'ready', 'failed')"
REPORT_ASSET_KIND_CHECK = "kind IN ('logo')"


class Report(Base):
    __tablename__ = "report"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)  # a ReportConfig dumped by_alias
    template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # display only
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_report_list", "archived", "updated_at", "id"),)


class ReportVersion(Base):
    __tablename__ = "report_version"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    report_id: Mapped[str] = mapped_column(String(36), ForeignKey("report.id", ondelete="CASCADE"))
    number: Mapped[int | None] = mapped_column(Integer, nullable=True)  # set on promote
    state: Mapped[str] = mapped_column(String, default="rendering", server_default="rendering")
    issued_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    folder: Mapped[str | None] = mapped_column(String, nullable=True)  # reports/<rid>/v003
    files: Mapped[list[Any]] = mapped_column(JSON, default=list)  # [{name, kind, bytes, sha256, pages}]
    config: Mapped[dict[str, Any]] = mapped_column(JSON)  # frozen copy of the config used
    baseline_version_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("report_version.id", ondelete="SET NULL"), nullable=True
    )
    # {finding_count, page_count, part_count, warnings, label, error}
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        CheckConstraint(REPORT_VERSION_STATE_CHECK, name="ck_report_version_state"),
        Index("ux_report_version_number", "report_id", "number", unique=True),
        Index("ix_report_version_issued", "issued_at"),
    )


class ReportVersionFinding(Base):
    """A finding's state in a version at render time: the next version's baseline (spec 8.3)."""

    __tablename__ = "report_version_finding"
    version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("report_version.id", ondelete="CASCADE"), primary_key=True
    )
    finding_id: Mapped[str] = mapped_column(String(36), primary_key=True)  # no FK: outlives the finding
    type_id: Mapped[str] = mapped_column(String(36))
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String)
    __table_args__ = (Index("ix_report_version_finding_finding", "finding_id"),)


class ReportAsset(Base):
    """A logo copied into the project as `reports/assets/logo-<sha8>.png` (spec 6.1)."""

    __tablename__ = "report_asset"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String, default="logo")
    path: Mapped[str] = mapped_column(String)
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        CheckConstraint(REPORT_ASSET_KIND_CHECK, name="ck_report_asset_kind"),
        Index("ux_report_asset_sha256", "sha256", unique=True),
    )
