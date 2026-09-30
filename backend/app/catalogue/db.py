"""The catalogue database (`catalogue.db`): catalogue types, the severity scale and a key/value
meta table (spec 2026-09-26-foundation section 7.1)."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, Index, Integer, String, false, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.base import UTCDateTime, new_id, utcnow


class CatalogueBase(DeclarativeBase):
    pass


class CatalogueType(CatalogueBase):
    __tablename__ = "catalogue_type"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    # normalise_name(name). Not in the spec's column list: the partial unique index below needs a
    # stored key, so "dump_truck" and "Dump truck" collide in the database, not only in Python.
    name_key: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))  # "#rrggbb", lower case
    kind: Mapped[str] = mapped_column(String)  # defect | object
    default_severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hotkey: Mapped[str | None] = mapped_column(String(1), nullable=True)  # 1-9 or a-z
    group: Mapped[str | None] = mapped_column(String, nullable=True)  # "Concrete defects"
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    origin: Mapped[str] = mapped_column(String, default="user")  # user | migrated
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint("kind IN ('defect', 'object')", name="ck_catalogue_type_kind"),
        CheckConstraint("origin IN ('user', 'migrated')", name="ck_catalogue_type_origin"),
        Index("ux_catalogue_type_live_name", "name_key", unique=True, sqlite_where=text("archived = 0")),
        Index(
            "ux_catalogue_type_live_hotkey",
            "hotkey",
            unique=True,
            sqlite_where=text("archived = 0 AND hotkey IS NOT NULL"),
        ),
    )


class SeverityLevel(CatalogueBase):
    __tablename__ = "severity_level"
    level: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))


class CatalogueMeta(CatalogueBase):
    """`needs_classification` (set by MG after a migration merged types), `seeded`."""

    __tablename__ = "catalogue_meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)


class ReportTemplate(CatalogueBase):
    """An app-wide report template (spec 2026-09-26-reports section 6.2, catalogue revision 0002).

    The four built-ins (`builtin=True`, fixed ids from app/reports/templates/builtins.py) are seeded
    by the migration and never edited. `config` is a portable ReportConfig dumped by_alias."""

    __tablename__ = "report_template"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, default="", server_default="")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    config: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_report_template_list", "builtin", "name", "id"),)
