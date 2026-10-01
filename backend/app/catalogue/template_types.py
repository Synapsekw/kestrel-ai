"""Resolving a template's types against the Catalogue (spec 2026-09-30-project-setup section 6,
index ruling S-R2, plan S1-U2 Rulings 2-7): `POST /catalogue/types/ensure`.

Unlike `service.ensure_types` (the Setup agent, class maps, MG), a name held only by an archived type
brings that type back, so a template naming "Corrosion" keeps the history of the "Corrosion" someone
archived. The Catalogue wins on a match (decision S1-3): nothing of the row changes except
`archived`, and a hotkey a live type now holds. One catalogue transaction: every type or none;
`dry_run` writes nothing.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.catalogue import service
from app.catalogue.db import CatalogueType, SeverityLevel
from app.catalogue.handle import CatalogueHandle
from app.catalogue.names import normalise_hotkey, normalise_name
from app.catalogue.schemas import CatalogueTypeSpec, EnsuredType, TypeConflict
from app.errors import AppError


def _checked(s, specs: Sequence[CatalogueTypeSpec]) -> list[tuple[CatalogueTypeSpec, str, list[dict]]]:
    """Every spec is validated before anything is looked up or written (Ruling 2): a name that
    normalises to nothing, a default severity or a rule off the current scale, more than eight
    rules. The refusal's details name the spec (`type_index`, `name`)."""
    levels = set(s.execute(select(SeverityLevel.level)).scalars())
    out: list[tuple[CatalogueTypeSpec, str, list[dict]]] = []
    for i, spec in enumerate(specs):
        key = normalise_name(spec.name)
        if not key:
            raise AppError(
                "type_name_blank",
                f"Type {i + 1} has a blank name.",
                422,
                {"type_index": i, "name": spec.name},
            )
        try:
            service._check_default_severity(s, spec.default_severity)
            rules = service._check_rules(s, spec.severity_rules, levels)
        except AppError as e:
            e.details = {**e.details, "type_index": i, "name": spec.name}
            raise
        out.append((spec, key, rules))
    return out


def _by_key(s, keys: set[str]) -> tuple[dict[str, CatalogueType], dict[str, CatalogueType]]:
    """The live row per key and, for a key with no live row, its most recently updated archived row."""
    rows = (
        s.execute(
            select(CatalogueType)
            .where(CatalogueType.name_key.in_(keys))
            .order_by(CatalogueType.updated_at.desc(), CatalogueType.id)
        )
        .scalars()
        .all()
    )
    live = {r.name_key: r for r in rows if not r.archived}
    archived: dict[str, CatalogueType] = {}
    for r in rows:
        if r.archived and r.name_key not in live:
            archived.setdefault(r.name_key, r)
    return live, archived


def _live_hotkeys(s) -> set[str]:
    return set(
        s.execute(
            select(CatalogueType.hotkey).where(
                CatalogueType.archived.is_(False), CatalogueType.hotkey.is_not(None)
            )
        ).scalars()
    )


def _conflict(row: CatalogueType, spec: CatalogueTypeSpec) -> TypeConflict | None:
    """A kind or colour that differs is reported, never applied (S1-3). A spec without a colour
    has no colour to differ."""
    colour_differs = spec.colour is not None and spec.colour.lower() != row.colour.lower()
    if spec.kind != row.kind or colour_differs:
        return TypeConflict(kind=row.kind, colour=row.colour)
    return None


def _new_row(s, spec: CatalogueTypeSpec, key: str, rules: list[dict], taken: set[str]) -> CatalogueType:
    """A miss becomes a `template` type with the spec's fields. Its hotkey is kept only when no live
    type holds it (Ruling 6); the project's own key comes with `POST /projects`."""
    hotkey = normalise_hotkey(spec.hotkey)
    if hotkey in taken:
        hotkey = None
    row = CatalogueType(
        name=" ".join(spec.name.split()),
        name_key=key,
        colour=(spec.colour or service._next_colour(s)).lower(),
        kind=spec.kind,
        default_severity=spec.default_severity,
        hotkey=hotkey,
        group=None,
        origin="template",
        definition=service._clean_definition(spec.definition),
        severity_rules=rules,
    )
    s.add(row)
    s.flush()
    if hotkey:
        taken.add(hotkey)
    return row


def ensure_template_types(
    cat: CatalogueHandle, specs: Sequence[CatalogueTypeSpec], *, dry_run: bool
) -> list[EnsuredType]:
    """One `EnsuredType` per spec, in request order. `id` is None only for a dry-run miss."""
    try:
        with cat.session() as s:
            checked = _checked(s, specs)
            live, archived = _by_key(s, {key for _, key, _ in checked})
            taken = _live_hotkeys(s)
            out: list[EnsuredType] = []
            planned: dict[str, CatalogueTypeSpec] = {}  # dry run: the first spec to miss each key
            for spec, key, rules in checked:
                row = live.get(key)
                if row is None and key in archived:
                    row = archived.pop(key)
                    if not dry_run:
                        row.archived = False
                        if row.hotkey in taken:
                            row.hotkey = None
                        elif row.hotkey:
                            taken.add(row.hotkey)
                    live[key] = row
                if row is not None:
                    out.append(
                        EnsuredType(name=row.name, id=row.id, created=False, conflict=_conflict(row, spec))
                    )
                elif dry_run:
                    first = planned.get(key)
                    if first is None:
                        planned[key] = spec
                        out.append(
                            EnsuredType(
                                name=" ".join(spec.name.split()), id=None, created=True, conflict=None
                            )
                        )
                    else:  # the real run would have created it from `first`; compare against that
                        colour_differs = (
                            spec.colour is not None
                            and first.colour is not None
                            and spec.colour.lower() != first.colour.lower()
                        )
                        conflict = None
                        if spec.kind != first.kind or colour_differs:
                            conflict = TypeConflict(
                                kind=first.kind, colour=(first.colour or service._next_colour(s)).lower()
                            )
                        out.append(
                            EnsuredType(
                                name=" ".join(first.name.split()), id=None, created=False, conflict=conflict
                            )
                        )
                else:
                    row = _new_row(s, spec, key, rules, taken)
                    live[key] = row
                    out.append(EnsuredType(name=row.name, id=row.id, created=True, conflict=None))
            return out
    except IntegrityError as e:  # a concurrent write took a name or hotkey between read and commit
        raise AppError(
            "type_exists", "Another change to the Catalogue got there first; try again.", 409
        ) from e
