"""Catalogue types and the severity scale (spec 2026-09-26-foundation sections 7.1-7.2).

The public entries other units call (BM's `CatalogueAdapter`, MG's catalogue merge, the project type
list): `resolve_types` looks types up by id; `find_by_names` and `ensure_types` match names by
`normalise_name` (`normalise_name` is re-exported from here); `add_project_types` appends to a
project's list.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import CatalogueMeta, CatalogueType, SeverityLevel
from app.catalogue.handle import DEFAULT_SCALE, CatalogueHandle
from app.catalogue.names import like_pattern, normalise_hotkey, normalise_name
from app.errors import AppError, not_found
from app.pagination import clamp_limit, decode_cursor, encode_cursor

KINDS = ("defect", "object")
ORIGINS = ("user", "migrated")
MAX_LEVELS = 9  # the review keys 1-9 set severity (spec section 5.6)
NEEDS_CLASSIFICATION = "needs_classification"
log = logging.getLogger(__name__)
PALETTE = (
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#ef4444",
    "#14b8a6",
    "#84cc16",
)


@dataclass(frozen=True)
class CatalogueTypeRef:
    id: str
    name: str
    colour: str
    kind: str
    default_severity: int | None
    hotkey: str | None
    group: str | None
    archived: bool
    origin: str


@dataclass(frozen=True)
class SeverityLevelRef:
    level: int
    name: str
    colour: str


def to_ref(row: CatalogueType) -> CatalogueTypeRef:
    return CatalogueTypeRef(
        id=row.id,
        name=row.name,
        colour=row.colour,
        kind=row.kind,
        default_severity=row.default_severity,
        hotkey=row.hotkey,
        group=row.group,
        archived=bool(row.archived),
        origin=row.origin,
    )


def _clean_name(name: str) -> tuple[str, str]:
    key = normalise_name(name)
    if not key:
        raise AppError("type_name_blank", "A type name cannot be blank.", 409)
    return " ".join(name.split()), key


def _group(value: str | None) -> str | None:
    """Whitespace collapsed; a blank group is no group."""
    if not value:
        return None
    return " ".join(value.split()) or None


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise AppError("validation_error", f"kind must be defect or object, not {kind!r}", 422)


def _check_default_severity(s, level: int | None) -> None:
    if level is None:
        return
    if s.get(SeverityLevel, level) is None:
        raise AppError("severity_unknown", f"There is no severity level {level}.", 422, {"level": level})


def _refuse_live_name(s, key: str, exclude: str | None = None) -> None:
    q = select(CatalogueType).where(CatalogueType.name_key == key, CatalogueType.archived.is_(False))
    if exclude:
        q = q.where(CatalogueType.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "type_exists",
            f"The catalogue already has a type called {holder.name}.",
            409,
            {"type_id": holder.id, "name": holder.name},
        )


def _refuse_live_hotkey(s, hotkey: str | None, exclude: str | None = None) -> None:
    if hotkey is None:
        return
    q = select(CatalogueType).where(CatalogueType.hotkey == hotkey, CatalogueType.archived.is_(False))
    if exclude:
        q = q.where(CatalogueType.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "hotkey_conflict",
            f"{holder.name} already uses the hotkey {hotkey}.",
            409,
            {"hotkey": hotkey, "type_id": holder.id},
        )


def _next_colour(s) -> str:
    n = s.execute(select(func.count()).select_from(CatalogueType)).scalar_one()
    return PALETTE[n % len(PALETTE)]


def create_type(
    cat: CatalogueHandle,
    *,
    name: str,
    colour: str | None = None,
    kind: str = "object",
    default_severity: int | None = None,
    hotkey: str | None = None,
    group: str | None = None,
    origin: str = "user",
) -> CatalogueTypeRef:
    clean, key = _clean_name(name)
    hotkey = normalise_hotkey(hotkey)
    _check_kind(kind)
    with cat.session() as s:
        _check_default_severity(s, default_severity)
        _refuse_live_name(s, key)
        _refuse_live_hotkey(s, hotkey)
        row = CatalogueType(
            name=clean,
            name_key=key,
            colour=(colour or _next_colour(s)).lower(),
            kind=kind,
            default_severity=default_severity,
            hotkey=hotkey,
            group=_group(group),
            origin=origin,
        )
        s.add(row)
        try:
            s.flush()
        except IntegrityError as e:  # a concurrent create of the same name or hotkey won the race
            raise AppError("type_exists", f"The catalogue already has a type called {clean}.", 409) from e
        return to_ref(row)


def get_type(cat: CatalogueHandle, type_id: str) -> CatalogueTypeRef:
    with cat.session() as s:
        row = s.get(CatalogueType, type_id)
        if row is None:
            raise not_found("catalogue type", type_id)
        return to_ref(row)


def resolve_types(cat: CatalogueHandle, type_ids: Iterable[str]) -> dict[str, CatalogueTypeRef]:
    """By id; an id the catalogue does not know is left out."""
    ids = list(dict.fromkeys(type_ids))
    if not ids:
        return {}
    with cat.session() as s:
        rows = s.execute(select(CatalogueType).where(CatalogueType.id.in_(ids))).scalars()
        return {r.id: to_ref(r) for r in rows}


def patch_type(
    cat: CatalogueHandle, type_id: str, fields: Mapping[str, Any]
) -> tuple[CatalogueTypeRef, bool]:
    """Apply a patch; the flag is True when the kind went object -> defect, so the UI offers the
    findings backfill (spec section 7.2). Defect -> object keeps every existing finding."""
    with cat.session() as s:
        row = s.get(CatalogueType, type_id)
        if row is None:
            raise not_found("catalogue type", type_id)
        was = row.kind
        clean, key = _clean_name(fields["name"]) if "name" in fields else (row.name, row.name_key)
        hotkey = normalise_hotkey(fields["hotkey"]) if "hotkey" in fields else row.hotkey
        archived = bool(fields.get("archived", row.archived))
        if "kind" in fields:
            _check_kind(fields["kind"])
        if "default_severity" in fields:
            _check_default_severity(s, fields["default_severity"])
        if not archived:
            _refuse_live_name(s, key, exclude=row.id)
            _refuse_live_hotkey(s, hotkey, exclude=row.id)
        row.name, row.name_key, row.hotkey, row.archived = clean, key, hotkey, archived
        if "colour" in fields and fields["colour"]:
            row.colour = fields["colour"].lower()
        if "kind" in fields:
            row.kind = fields["kind"]
        if "default_severity" in fields:
            row.default_severity = fields["default_severity"]
        if "group" in fields:
            row.group = _group(fields["group"])
        s.flush()
        return to_ref(row), was == "object" and row.kind == "defect"


def list_types(
    cat: CatalogueHandle,
    *,
    q: str | None = None,
    kind: str | None = None,
    origin: str | None = None,
    include_archived: bool = False,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[CatalogueTypeRef], str | None]:
    n = clamp_limit(limit)
    query = select(CatalogueType)
    if not include_archived:
        query = query.where(CatalogueType.archived.is_(False))
    if kind:
        query = query.where(CatalogueType.kind == kind)
    if origin:
        query = query.where(CatalogueType.origin == origin)
    if q and normalise_name(q):
        query = query.where(CatalogueType.name_key.like(like_pattern(normalise_name(q)), escape="\\"))
    c = decode_cursor(cursor, "k", "id")
    if c:
        query = query.where(tuple_(CatalogueType.name_key, CatalogueType.id) > tuple_(c["k"], c["id"]))
    with cat.session() as s:
        rows = (
            s.execute(query.order_by(CatalogueType.name_key, CatalogueType.id).limit(n + 1)).scalars().all()
        )
        refs = [to_ref(r) for r in rows[:n]]
        nxt = encode_cursor(k=rows[n - 1].name_key, id=rows[n - 1].id) if len(rows) > n else None
    return refs, nxt


def _live_by_key(s, keys: set[str]) -> dict[str, CatalogueType]:
    rows = s.execute(
        select(CatalogueType).where(CatalogueType.name_key.in_(keys), CatalogueType.archived.is_(False))
    ).scalars()
    return {r.name_key: r for r in rows}


def find_by_names(cat: CatalogueHandle, names: Sequence[str]) -> dict[str, CatalogueTypeRef]:
    """Each name that matches a live type by `normalise_name` -> that type (names that normalise
    alike share one); an unmatched name is left out."""
    keys = {name: normalise_name(name) for name in names}
    with cat.session() as s:
        found = _live_by_key(s, {k for k in keys.values() if k})
        return {name: to_ref(found[key]) for name, key in keys.items() if key in found}


def ensure_types(
    cat: CatalogueHandle,
    names: Sequence[str],
    *,
    kind: str = "object",
    origin: str = "user",
    colours: Mapping[str, str] | None = None,
    hotkeys: Mapping[str, str | None] | None = None,
) -> dict[str, CatalogueTypeRef]:
    """`find_by_names`, creating each unmatched name as a new type of `kind` and `origin`: the Setup
    agent's "create missing as object" (spec section 7.3) and MG's catalogue merge (section 11.4
    step 1). A new type's colour comes from `colours`, its hotkey from `hotkeys` only when that
    hotkey is free. A name held only by an archived type gets a new live type (names are unique
    among live types only). A blank name is left out."""
    keys = {name: normalise_name(name) for name in names}
    with cat.session() as s:
        found = _live_by_key(s, {k for k in keys.values() if k})
        taken = set(
            s.execute(
                select(CatalogueType.hotkey).where(
                    CatalogueType.archived.is_(False), CatalogueType.hotkey.is_not(None)
                )
            ).scalars()
        )
        out: dict[str, CatalogueTypeRef] = {}
        for name, key in keys.items():
            if not key:
                continue
            row = found.get(key)
            if row is None:
                try:
                    hotkey = normalise_hotkey((hotkeys or {}).get(name))
                except AppError:
                    hotkey = None
                if hotkey in taken:
                    hotkey = None
                row = CatalogueType(
                    name=" ".join(name.split()),
                    name_key=key,
                    colour=((colours or {}).get(name) or _next_colour(s)).lower(),
                    kind=kind,
                    origin=origin,
                    hotkey=hotkey,
                )
                s.add(row)
                s.flush()
                if hotkey:
                    taken.add(hotkey)
                found[key] = row
            out[name] = to_ref(row)
    return out


def add_project_types(handle, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> list[str]:
    """Append types to a project's list in its own transaction (BM's run start, spec section 7.4);
    returns the ids that were added. See `project_types.add_types` for the in-session form."""
    from app.catalogue import project_types  # project_types imports this module

    with handle.session() as s:
        return project_types.add_types(s, cat, list(type_ids))


def get_scale(cat: CatalogueHandle) -> list[SeverityLevelRef]:
    with cat.session() as s:
        rows = s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()
        return [SeverityLevelRef(r.level, r.name, r.colour) for r in rows]


def scale_levels(cat: CatalogueHandle | None) -> list[int]:
    """The scale's levels; D4's 1-4 when the catalogue is unavailable (decision F2)."""
    if cat is not None:
        try:
            return [lv.level for lv in get_scale(cat)]
        except Exception:
            log.exception("the severity scale could not be read")
    return [lv for lv, _, _ in DEFAULT_SCALE]


def put_scale(
    cat: CatalogueHandle, levels: Sequence[Mapping[str, Any]], level_in_use: Callable[[int], list[str]]
) -> list[SeverityLevelRef]:
    """Replace the scale: rename and recolour always, append at the top, and remove top levels only
    when `level_in_use(level)` names no project (spec section 7.2). Defaults above the new top are
    cleared.

    The scale-shape refusal is `invalid_scale` 422 (controller ruling on the merged contract's
    code), not the brief's `severity_scale_invalid` 409."""
    wanted = sorted(levels, key=lambda lv: lv["level"])
    numbers = [lv["level"] for lv in wanted]
    if not 1 <= len(numbers) <= MAX_LEVELS or numbers != list(range(1, len(numbers) + 1)):
        raise AppError(
            "invalid_scale",
            f"Levels run 1, 2, 3 ... with no gaps, 1 to {MAX_LEVELS} of them.",
            422,
            {"levels": numbers},
        )
    if any(not str(lv["name"]).strip() for lv in wanted):
        raise AppError("invalid_scale", "Every severity level needs a name.", 422, {"levels": numbers})
    with cat.session() as s:
        top = s.execute(select(func.coalesce(func.max(SeverityLevel.level), 0))).scalar_one()
        for level in range(top, len(numbers), -1):  # the highest removed level first
            projects = level_in_use(level)
            if projects:
                raise AppError(
                    "severity_in_use",
                    f"Level {level} is still used by findings in {', '.join(projects)}.",
                    409,
                    {"level": level, "projects": projects},
                )
        s.execute(delete(SeverityLevel))
        s.add_all(
            SeverityLevel(level=lv["level"], name=str(lv["name"]).strip(), colour=str(lv["colour"]).lower())
            for lv in wanted
        )
        s.execute(
            update(CatalogueType)
            .where(CatalogueType.default_severity > len(numbers))
            .values(default_severity=None)
        )
    return get_scale(cat)


def get_meta(cat: CatalogueHandle, key: str, default: Any = None) -> Any:
    with cat.session() as s:
        row = s.get(CatalogueMeta, key)
        return default if row is None else row.value


def set_meta(cat: CatalogueHandle, key: str, value: Any) -> None:
    with cat.session() as s:
        row = s.get(CatalogueMeta, key)
        if row is None:
            s.add(CatalogueMeta(key=key, value=value))
        else:
            row.value = value
