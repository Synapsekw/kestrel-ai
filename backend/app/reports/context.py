"""The compose context and the finding iterator (spec 2026-09-26-reports §8.2; plan R2).

`ComposeContext(handle=, config=, report_id=, baseline=, generated_at=)` is built once per compose,
outline or blocks request. It resolves the filters into one SQL WHERE and reads the severity scale
eagerly and the type snapshots once; it holds no session. Every read opens a short
`ctx.session()`. `findings_page` reads one keyset page of at most 200 findings as plain `FindingRow`s;
`iter_findings` chains the pages, so nothing ever holds all findings as ORM rows.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from functools import cached_property
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import and_, func, or_, select

from app.catalogue import service as catalogue_service
from app.catalogue.handle import DEFAULT_SCALE
from app.db.models import Finding, ProjectType
from app.errors import AppError
from app.findings.numbers import format_number
from app.pagination import decode_cursor, encode_cursor
from app.reports.filters import finding_where
from app.reports.observed import data_label, host_label, observed_day, observed_on
from app.reports.schemas import ReportConfig, ReportWarning, SnapshotRef, SnapshotSpec

log = logging.getLogger(__name__)

PAGE = 200
ORDERS = ("number", "severity_desc", "type", "observed")
NO_SEVERITY = -1  # ungraded sorts after every level in severity_desc
UNGRADED = "Ungraded"
GREY = "#5E5C7A"  # the print theme's muted ink (spec §10.1)
UNKNOWN_TYPE = "Unknown type"
NO_ENGINE = "The snapshot engine is not installed."
INT64 = 2**63  # SQLite binds only int64; a larger cursor integer would raise OverflowError (a 500)
_SPEC = TypeAdapter(SnapshotSpec)


@dataclass(frozen=True)
class TypeInfo:
    name: str
    colour: str
    kind: str


@dataclass(frozen=True)
class Level:
    level: int | None
    name: str
    colour: str


@dataclass(frozen=True)
class Baseline:
    version_id: str
    report_id: str
    number: int
    issued_at: datetime
    report_title: str = ""


@dataclass(frozen=True)
class SectionStats:
    block_count: int
    estimated_pages: int


@dataclass(frozen=True)
class FindingRow:
    id: str
    number: int
    label: str
    type_id: str
    type_name: str
    type_colour: str
    type_kind: str
    severity: int | None
    severity_name: str
    severity_colour: str
    status: str
    note: str
    created_by: str
    confidence: float | None
    anchor_kind: str
    image_id: str | None
    annotation_id: str | None
    map_id: str | None
    geometry: dict | None
    cloud_id: str | None
    x: float | None
    y: float | None
    z: float | None
    uncertainty_m: float | None
    lon: float | None
    lat: float | None
    data_type: str
    data_id: str
    data_label: str
    observed_on: date
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
    closed_at: datetime | None
    asset_model_id: str | None = None
    asset_version: int | None = None
    height_m: float | None = None
    bearing_deg: float | None = None
    side: str | None = None
    zone: str | None = None
    component: str | None = None
    placement: str | None = None
    sighting_count: int = 0
    ax: float | None = None
    ay: float | None = None
    az: float | None = None
    an_x: float | None = None
    an_y: float | None = None
    an_z: float | None = None

    @classmethod
    def build(cls, ctx: ComposeContext | None, src: Any, *, data_label: str, observed_on: date) -> FindingRow:
        """`src` is a Finding or a result row with Finding's column names."""
        t = ctx.type_info(src.type_id) if ctx else TypeInfo(UNKNOWN_TYPE, GREY, "defect")
        lv = ctx.level(src.severity) if ctx else _fallback_level(src.severity)
        return cls(
            id=src.id,
            number=src.number,
            label=format_number(src.number),
            type_id=src.type_id,
            type_name=t.name,
            type_colour=t.colour,
            type_kind=t.kind,
            severity=src.severity,
            severity_name=lv.name,
            severity_colour=lv.colour,
            status=src.status,
            note=src.note or "",
            created_by=src.created_by,
            confidence=src.confidence,
            anchor_kind=src.anchor_kind,
            image_id=src.image_id,
            annotation_id=src.annotation_id,
            map_id=src.map_id,
            geometry=src.geometry,
            cloud_id=src.cloud_id,
            x=src.x,
            y=src.y,
            z=src.z,
            uncertainty_m=src.uncertainty_m,
            lon=src.lon,
            lat=src.lat,
            data_type=src.data_type,
            data_id=src.data_id,
            data_label=data_label or "",
            observed_on=observed_on,
            created_at=src.created_at,
            updated_at=src.updated_at,
            reviewed_at=src.reviewed_at,
            closed_at=src.closed_at,
            asset_model_id=getattr(src, "asset_model_id", None),
            asset_version=getattr(src, "asset_version", None),
            height_m=getattr(src, "height_m", None),
            bearing_deg=getattr(src, "bearing_deg", None),
            side=getattr(src, "side", None),
            zone=getattr(src, "zone", None),
            component=getattr(src, "component", None),
            placement=getattr(src, "placement", None),
            sighting_count=int(getattr(src, "sighting_count", 0) or 0),
            ax=getattr(src, "ax", None),
            ay=getattr(src, "ay", None),
            az=getattr(src, "az", None),
            an_x=getattr(src, "an_x", None),
            an_y=getattr(src, "an_y", None),
            an_z=getattr(src, "an_z", None),
        )

    @classmethod
    def from_finding(cls, f: Finding, ctx: ComposeContext | None = None) -> FindingRow:
        """One ORM finding (still in its session) as the row the iterator would yield."""
        from sqlalchemy.orm import object_session

        s = object_session(f)
        if s is None:
            raise RuntimeError("FindingRow.from_finding needs a finding attached to a session")
        return cls.build(ctx, f, data_label=host_label(s, f), observed_on=observed_day(s, f))


def _fallback_level(severity: int | None) -> Level:
    if severity is None:
        return Level(None, UNGRADED, GREY)
    for lv, name, colour in DEFAULT_SCALE:
        if lv == severity:
            return Level(lv, name, colour)
    return Level(severity, f"Level {severity}", GREY)


def read_scale(handle) -> list[Level]:
    cat = getattr(handle, "catalogue", None)
    if cat is not None:
        try:
            return [Level(r.level, r.name, r.colour) for r in catalogue_service.get_scale(cat)]
        except Exception:
            log.exception("the severity scale could not be read; using the default")
    return [Level(lv, name, colour) for lv, name, colour in DEFAULT_SCALE]


def _engine_key(handle, spec) -> str:
    from app.reports.snapshots.keys import snapshot_key  # R3; lazy so compose never needs PIL at import

    return snapshot_key(handle, spec)


@dataclass
class ComposeContext:
    handle: Any  # ProjectHandle
    config: ReportConfig
    report_id: str
    baseline: Baseline | None
    generated_at: datetime
    version: int | None = None
    issued: bool = False
    key_for: Callable[[Any], str] | None = None
    warnings: list[ReportWarning] = field(default_factory=list)
    _templates: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    where: Any = field(init=False, repr=False)
    scale: list[Level] = field(init=False)

    def __post_init__(self) -> None:
        g = self.generated_at
        self.generated_at = g.replace(tzinfo=UTC) if g.tzinfo is None else g.astimezone(UTC)
        since = self.baseline.issued_at.astimezone(UTC).date() if self.baseline is not None else None
        self.where = finding_where(self.config.filters, today=self.today, since=since)
        self.scale = read_scale(self.handle)

    @property
    def today(self) -> date:
        return self.generated_at.date()

    def session(self):
        return self.handle.session()

    @cached_property
    def types(self) -> dict[str, TypeInfo]:
        with self.session() as s:
            return {
                r.type_id: TypeInfo(r.name, r.colour, r.kind)
                for r in s.execute(select(ProjectType)).scalars()
            }

    @cached_property
    def project_name(self) -> str:
        with self.session() as s:
            return self.handle.row(s).name

    @cached_property
    def asset_models(self):
        """{id: AssetInfo} for every asset model of the project (tens), read once per context."""
        from app.reports.asset_info import load_asset_models  # lazy: P1 loads only when asked

        return load_asset_models(self.handle)

    def options(self, key: str):
        for sec in self.config.sections:
            if sec.key == key:
                return sec.options
        raise KeyError(key)

    def level(self, severity: int | None) -> Level:
        if severity is None:
            return Level(None, UNGRADED, GREY)
        for lv in self.scale:
            if lv.level == severity:
                return lv
        return Level(severity, f"Level {severity}", GREY)

    def type_info(self, type_id: str) -> TypeInfo:
        return self.types.get(type_id) or TypeInfo(UNKNOWN_TYPE, GREY, "defect")

    def warn(self, code: str, message: str, *, count: int | None = None, link: str | None = None) -> None:
        """Aggregates per code (Ruling 18): a repeated code adds `count` (1 when omitted) to the first
        warning's count; a `{n}` in the first message is re-formatted with the total; the first link stays."""
        n = 1 if count is None else count
        for i, w in enumerate(self.warnings):
            if w.code == code:
                total = (w.count or 0) + n
                template = self._templates.get(code, w.message)  # total over pre-seeded warnings
                text = template.format(n=total) if "{n}" in template else w.message
                self.warnings[i] = w.model_copy(update={"count": total, "message": text})
                return
        self._templates[code] = message
        text = message.format(n=n) if "{n}" in message else message
        self.warnings.append(
            ReportWarning.model_validate({"code": code, "message": text, "count": n, "link": link})
        )

    def ref(self, spec, *, width_px: int, height_px: int, missing_reason: str | None = None) -> SnapshotRef:
        model = _SPEC.validate_python(spec)
        try:
            key = self.key_for(model) if self.key_for is not None else _engine_key(self.handle, model)
        except ImportError:
            log.warning("the snapshot engine is not installed; a %s figure has no key", type(model).__name__)
            # P1 (controller ruling): SnapshotRef.key must match ^[0-9a-f]{32}$, so the engine-missing
            # path can never use "" — hash the spec instead.
            key = hashlib.sha256(
                json.dumps(model.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()[:32]
            missing_reason = missing_reason or NO_ENGINE
        return SnapshotRef.model_validate(
            {
                "key": key,
                "spec": model,
                "width_px": width_px,
                "height_px": height_px,
                "missing_reason": missing_reason,
            }
        )


def type_name():
    name = (
        select(ProjectType.name)
        .where(ProjectType.type_id == Finding.type_id)
        .correlate(Finding)
        .scalar_subquery()
    )
    return func.coalesce(name, "")


_COLUMNS = (
    Finding.id,
    Finding.number,
    Finding.type_id,
    Finding.severity,
    Finding.status,
    Finding.note,
    Finding.created_by,
    Finding.confidence,
    Finding.anchor_kind,
    Finding.image_id,
    Finding.annotation_id,
    Finding.map_id,
    Finding.geometry,
    Finding.cloud_id,
    Finding.x,
    Finding.y,
    Finding.z,
    Finding.uncertainty_m,
    Finding.lon,
    Finding.lat,
    Finding.data_type,
    Finding.data_id,
    Finding.created_at,
    Finding.updated_at,
    Finding.reviewed_at,
    Finding.closed_at,
    Finding.asset_model_id,
    Finding.asset_version,
    Finding.height_m,
    Finding.bearing_deg,
    Finding.side,
    Finding.zone,
    Finding.component,
    Finding.placement,
    Finding.sighting_count,
    Finding.ax,
    Finding.ay,
    Finding.az,
    Finding.an_x,
    Finding.an_y,
    Finding.an_z,
)


def _scope(ctx: ComposeContext, where):
    return ctx.where if where is None else and_(ctx.where, where)


def count_findings(ctx: ComposeContext, *, where=None) -> int:
    with ctx.session() as s:
        return s.execute(select(func.count()).select_from(Finding).where(_scope(ctx, where))).scalar_one()


def findings_page(
    ctx: ComposeContext,
    order: str = "number",
    cursor: str | None = None,
    limit: int = PAGE,
    *,
    where=None,
) -> tuple[list[FindingRow], str | None]:
    if order not in ORDERS:
        raise AppError("validation_error", f"order is one of {', '.join(ORDERS)}", 422)
    n = max(1, min(PAGE, int(limit)))
    c = decode_cursor(cursor, "o", "n")
    if c:
        if c["o"] != order or (order != "number" and "k" not in c):
            raise AppError("validation_error", "invalid cursor", 422)
        cn = c["n"]
        if not isinstance(cn, int) or isinstance(cn, bool) or not 0 <= cn < INT64:
            raise AppError("validation_error", "invalid cursor", 422)
        if order == "severity_desc":
            ck = c["k"]
            if not isinstance(ck, int) or isinstance(ck, bool) or not -INT64 <= ck < INT64:
                raise AppError("validation_error", "invalid cursor", 422)
        elif order in ("type", "observed"):
            ck = c["k"]
            if not isinstance(ck, str):
                raise AppError("validation_error", "invalid cursor", 422)
            if order == "observed":
                try:
                    date.fromisoformat(ck)
                except ValueError:
                    raise AppError("validation_error", "invalid cursor", 422) from None
    obs, tname = observed_on(), type_name()
    sev = func.coalesce(Finding.severity, NO_SEVERITY)
    q = select(
        *_COLUMNS,
        obs.label("observed_on"),
        data_label().label("data_label"),
        tname.label("type_name"),
        sev.label("sev_key"),
    ).where(_scope(ctx, where))
    if order == "number":
        if c:
            q = q.where(Finding.number > c["n"])
        q = q.order_by(Finding.number.asc())
    elif order == "severity_desc":
        if c:
            q = q.where(or_(sev < c["k"], and_(sev == c["k"], Finding.number > c["n"])))
        q = q.order_by(sev.desc(), Finding.number.asc())
    else:
        col = tname if order == "type" else obs
        if c:
            q = q.where(or_(col > c["k"], and_(col == c["k"], Finding.number > c["n"])))
        q = q.order_by(col.asc(), Finding.number.asc())
    with ctx.session() as s:
        rows = s.execute(q.limit(n + 1)).all()
    out = [
        FindingRow.build(ctx, r, data_label=r.data_label, observed_on=date.fromisoformat(r.observed_on))
        for r in rows[:n]
    ]
    if len(rows) <= n:
        return out, None
    last = rows[n - 1]
    k = {"number": None, "severity_desc": last.sev_key, "type": last.type_name, "observed": last.observed_on}[
        order
    ]
    return out, encode_cursor(o=order, n=last.number, k=k)


def iter_findings(ctx: ComposeContext, order: str = "number") -> Iterator[FindingRow]:
    cursor: str | None = None
    while True:
        rows, cursor = findings_page(ctx, order, cursor)
        yield from rows
        if cursor is None:
            return
