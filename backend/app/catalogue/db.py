"""The catalogue database (`catalogue.db`): catalogue types, the severity scale and a key/value
meta table (spec 2026-09-26-foundation section 7.1), report templates (revision 0002), project
templates (revision 0003) and report brands (revision 0004)."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, Index, Integer, String, Text, false, text
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
    origin: Mapped[str] = mapped_column(String, default="user")  # user | migrated | template
    # Project setup (spec 2026-09-30-project-setup section 5, revision 0003): what the anomaly looks
    # like, and ordered `{when, severity}` rules (at most 8; S2 applies them).
    definition: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity_rules: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint("kind IN ('defect', 'object')", name="ck_catalogue_type_kind"),
        CheckConstraint("origin IN ('user', 'migrated', 'template')", name="ck_catalogue_type_origin"),
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


class ProjectTemplate(CatalogueBase):
    """A project template (spec 2026-09-30-project-setup section 5, catalogue revision 0003): slots
    and anomaly types that pre-fill the new-project page; never stored on a project.

    The three built-ins (`builtin=True`, fixed ids from app/setup/builtins.py) are seeded by the
    migration and never edited. `config` is a TemplateConfig dumped as JSON. `name_key` is
    `normalise_name(name)`, unique, so "Tower checks" and "tower_checks" are one name."""

    __tablename__ = "project_template"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    name_key: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(300), default="", server_default="")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    config: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ux_project_template_name_key", "name_key", unique=True),)


class Brand(CatalogueBase):
    """A report brand (spec 2026-10-02-asset-findings §5.8, catalogue revision 0004): colours, fonts,
    three logos and the footer text a report prints with when `ReportConfig.brand_id` names it.

    The two built-ins (`builtin=True`, fixed ids from app/brands/builtins.py) are seeded by the
    migration; they can be edited (the operator adds e&'s logos here) but never deleted. `colors` is
    `{accent, accent_dark, navy, ink, pale, line}`, upper-case hex. `font_text` and `font_numerals` are
    bundled family names (app/brands/fonts.py). A logo column holds a brand logo id (`logo-<16 hex>`,
    a PNG under `<catalogue root>/brand-assets/`). `name_key` is `normalise_name(name)`, unique."""

    __tablename__ = "brand"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    name_key: Mapped[str] = mapped_column(String(80))
    colors: Mapped[dict] = mapped_column(JSON)
    font_text: Mapped[str | None] = mapped_column(String(80), nullable=True)
    font_numerals: Mapped[str | None] = mapped_column(String(80), nullable=True)
    logo_on_light: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logo_on_dark: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logo_flat: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str] = mapped_column(String(200), default="", server_default="")
    owner: Mapped[str] = mapped_column(String(120), default="", server_default="")
    confidentiality: Mapped[str] = mapped_column(Text, default="", server_default="")
    pdf_author: Mapped[str] = mapped_column(String(120), default="", server_default="")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ux_brand_name_key", "name_key", unique=True),)
