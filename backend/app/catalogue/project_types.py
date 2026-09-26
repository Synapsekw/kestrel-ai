"""The project type list (spec 2026-09-26-foundation section 7.3): the ordered catalogue types a
project uses, each with a snapshot of its catalogue row (decision F2), so a project renders its
annotations and findings even when the catalogue cannot open or the project came from another
machine.

Every function that writes takes the caller's project session: the list and whatever depends on it
change in one transaction.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue import service as catalogue
from app.catalogue.handle import CatalogueHandle, catalogue_unavailable
from app.catalogue.names import normalise_hotkey
from app.db.base import utcnow
from app.db.models import Box, Finding, Project, ProjectType
from app.errors import AppError

SNAPSHOT = ("name", "colour", "kind", "default_severity", "hotkey", "group")
log = logging.getLogger(__name__)

__all__ = [
    "ProjectType",
    "add_types",
    "append_by_names",
    "check_removed_types_unused",
    "effective_hotkey",
    "lookup_types",
    "project_classes",
    "refresh_handle",
    "refresh_open_projects",
    "refresh_snapshots",
    "set_types",
]


def effective_hotkey(row: ProjectType) -> str | None:
    """The project's override when set ("" = none in this project), else the catalogue's hotkey."""
    if row.hotkey_override is None:
        return row.hotkey
    return row.hotkey_override or None


def project_classes(s: Session, legacy: Project | None = None) -> list[dict]:
    """The list as ClassDef dicts, in order. A project from before the foundation (`schema_version`
    below 2) that has no type rows yet shows its legacy classes, whose ids its boxes still carry,
    until MG's migration fills `project_type` (spec section 11.4 steps 1-3)."""
    rows = s.execute(select(ProjectType).order_by(ProjectType.position, ProjectType.type_id)).scalars().all()
    if not rows and legacy is not None and (legacy.schema_version or 1) < 2:
        return [
            {
                "id": c["id"],
                "name": c["name"],
                "colour": c.get("colour") or "#4f46e5",
                "hotkey": c.get("hotkey"),
                "order": c.get("order", i),
                "kind": "object",
                "default_severity": None,
                "group": None,
            }
            for i, c in enumerate(legacy.legacy_classes or [])
        ]
    return [
        {
            "id": r.type_id,
            "name": r.name,
            "colour": r.colour,
            "hotkey": effective_hotkey(r),
            "order": r.position,
            "kind": r.kind,
            "default_severity": r.default_severity,
            "group": r.group,
        }
        for r in rows
    ]


def lookup_types(
    cat: CatalogueHandle | None, type_ids: Sequence[str]
) -> dict[str, catalogue.CatalogueTypeRef]:
    """The catalogue rows for these ids: 503 without a catalogue, 422 `unknown_type` for a stranger."""
    ids = list(dict.fromkeys(type_ids))
    if not ids:
        return {}
    if cat is None:
        raise catalogue_unavailable()
    found = catalogue.resolve_types(cat, ids)
    missing = [t for t in ids if t not in found]
    if missing:
        raise AppError(
            "unknown_type", f"Not catalogue types: {', '.join(missing)}.", 422, {"type_ids": missing}
        )
    return found


def _snapshot(row: ProjectType, ref: catalogue.CatalogueTypeRef) -> None:
    for field in SNAPSHOT:
        setattr(row, field, getattr(ref, field))
    row.refreshed_at = utcnow()


def _check_hotkeys(rows: Iterable[ProjectType]) -> None:
    seen: dict[str, ProjectType] = {}
    for r in rows:
        key = effective_hotkey(r)
        if not key:
            continue
        if key in seen:
            raise AppError(
                "hotkey_conflict",
                f"{seen[key].name} and {r.name} both use the hotkey {key} in this project.",
                409,
                {"hotkey": key, "type_id": seen[key].type_id, "type_ids": [seen[key].type_id, r.type_id]},
            )
        seen[key] = r


def check_removed_types_unused(s: Session, type_ids: Iterable[str]) -> None:
    """The `class_in_use` rule, now counting findings too (spec section 7.3)."""
    for type_id in type_ids:
        boxes = s.execute(select(func.count()).select_from(Box).where(Box.class_id == type_id)).scalar_one()
        findings = s.execute(
            select(func.count()).select_from(Finding).where(Finding.type_id == type_id)
        ).scalar_one()
        if boxes or findings:
            row = s.get(ProjectType, type_id)
            name = row.name if row is not None else type_id
            raise AppError(
                "class_in_use",
                f"{name} still has {boxes} annotations and {findings} findings; "
                "reassign or delete them first.",
                409,
                {"type_id": type_id, "class_id": type_id, "box_count": boxes, "finding_count": findings},
            )


def set_types(
    s: Session,
    cat: CatalogueHandle | None,
    type_ids: Sequence[str],
    hotkeys: Mapping[str, str | None] | None = None,
) -> None:
    """Make the list exactly `type_ids`, in that order. New ids need the catalogue; kept ids keep
    their snapshot. `hotkeys` sets overrides: {type_id: key}, null clears one, and a type left out
    keeps its override (the contract's `ProjectTypesUpdate.hotkeys`)."""
    wanted = list(dict.fromkeys(type_ids))
    existing = {r.type_id: r for r in s.execute(select(ProjectType)).scalars()}
    removed = [t for t in existing if t not in set(wanted)]
    check_removed_types_unused(s, removed)
    refs = lookup_types(cat, [t for t in wanted if t not in existing])
    overrides = {t: r.hotkey_override for t, r in existing.items()}
    overrides.update({t: normalise_hotkey(k) for t, k in (hotkeys or {}).items() if t in set(wanted)})
    for t in removed:
        s.delete(existing[t])
    rows: list[ProjectType] = []
    for position, t in enumerate(wanted):
        row = existing.get(t)
        if row is None:
            row = ProjectType(type_id=t)
            _snapshot(row, refs[t])
            s.add(row)
        row.position = position
        row.hotkey_override = overrides.get(t)
        rows.append(row)
    _check_hotkeys(rows)
    s.flush()


def add_types(s: Session, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> list[str]:
    """Append the ids the list does not hold yet (a run's mapped types, a finding's type). A clash
    of the new type's hotkey with this project's list clears it for this project only."""
    rows = s.execute(select(ProjectType).order_by(ProjectType.position)).scalars().all()
    held = {r.type_id for r in rows}
    new = [t for t in dict.fromkeys(type_ids) if t not in held]
    if not new:
        return []
    refs = lookup_types(cat, new)
    taken = {effective_hotkey(r) for r in rows} - {None}
    top = max((r.position for r in rows), default=-1)
    for i, t in enumerate(new):
        row = ProjectType(type_id=t, position=top + 1 + i)
        _snapshot(row, refs[t])
        if row.hotkey and row.hotkey in taken:
            row.hotkey_override = ""
        elif row.hotkey:
            taken.add(row.hotkey)
        s.add(row)
    s.flush()
    return new


def refresh_snapshots(s: Session, cat: CatalogueHandle | None, type_ids: Iterable[str] | None = None) -> int:
    """Copy the catalogue's current name, colour, kind, default severity, hotkey and group into the
    snapshot rows; returns how many changed. Without a catalogue, or for a type this catalogue does
    not know (a project from another machine), the snapshot stays as it is."""
    if cat is None:
        return 0
    q = select(ProjectType)
    if type_ids is not None:
        q = q.where(ProjectType.type_id.in_(list(type_ids)))
    rows = s.execute(q).scalars().all()
    refs = catalogue.resolve_types(cat, [r.type_id for r in rows])
    changed = 0
    for row in rows:
        ref = refs.get(row.type_id)
        if ref is None or all(getattr(row, f) == getattr(ref, f) for f in SNAPSHOT):
            continue
        _snapshot(row, ref)
        changed += 1
    return changed


def refresh_handle(handle) -> int:
    """On project open (spec section 7.3)."""
    with handle.session() as s:
        return refresh_snapshots(s, handle.catalogue)


def refresh_open_projects(registry, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> None:
    """After a catalogue edit: every open project's snapshot of these types. A failing project is
    logged; its snapshot refreshes on its next open."""
    for h in registry.open_handles():
        try:
            with h.session() as s:
                refresh_snapshots(s, cat, type_ids)
        except Exception:
            log.exception("could not refresh the type snapshot of project %s", h.id)


def append_by_names(s: Session, cat: CatalogueHandle | None, names: Sequence[str]) -> dict[str, str]:
    """Resolve names against the catalogue (a missing one becomes a new `object` type), append them
    to the list, and return {name: type_id} for the whole list and for every requested name."""
    if cat is None:
        raise catalogue_unavailable()
    refs = catalogue.ensure_types(cat, [n for n in names if n.strip()])
    add_types(s, cat, [r.id for r in refs.values()])
    out = {c["name"]: c["id"] for c in project_classes(s)}
    out.update({name: ref.id for name, ref in refs.items()})
    return out
