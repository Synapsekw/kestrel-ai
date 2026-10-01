"""Project templates (spec 2026-09-30-project-setup sections 4 S1-4, 5, 9; plan S1-U2 Task 3).

Stored in `catalogue.db` beside the Catalogue. The three built-ins are seeded by catalogue
migration 0003 (index ruling S-R1) and are read-only here (409 `template_builtin`). A template is a
pre-fill for the setup page, never stored on a project (decision S1-1).
"""

from __future__ import annotations

import logging

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import ProjectTemplate
from app.catalogue.handle import CatalogueHandle
from app.catalogue.names import normalise_name
from app.db.base import new_id
from app.errors import AppError, not_found
from app.setup.schemas import ProjectTemplateCreate, ProjectTemplateOut, ProjectTemplatePatch, TemplateConfig

LIST_CAP = 500  # ProjectTemplatePage has no cursor; an operator keeps a handful of templates
log = logging.getLogger(__name__)


def invalid_template(errors: list[dict]) -> AppError:
    return AppError(
        "invalid_template", f"The template is not valid: {errors[0]['message']}", 422, {"errors": errors}
    )


def validate_config(config: TemplateConfig) -> None:
    """The rules the schema cannot state (plan Ruling 8): slot keys, type names by `normalise_name`
    and type hotkeys (case-insensitive) are each unique in the template, and no type name is blank.
    422 `invalid_template` with one `{path, message}` per problem, dotted from the request body."""
    errors: list[dict] = []
    slots: set[str] = set()
    for i, slot in enumerate(config.slots):
        if slot.key in slots:
            errors.append(
                {"path": f"config.slots.{i}.key", "message": f"Slot key {slot.key!r} is used twice."}
            )
        slots.add(slot.key)
    names: dict[str, int] = {}
    hotkeys: dict[str, int] = {}
    for i, t in enumerate(config.types):
        key = normalise_name(t.name)
        if not key:
            errors.append({"path": f"config.types.{i}.name", "message": "A type name cannot be blank."})
        elif key in names:
            first = config.types[names[key]].name
            errors.append(
                {"path": f"config.types.{i}.name", "message": f"{t.name!r} is the same type as {first!r}."}
            )
        else:
            names[key] = i
        if t.hotkey:
            hk = t.hotkey.lower()
            if hk in hotkeys:
                first = config.types[hotkeys[hk]].name
                errors.append(
                    {"path": f"config.types.{i}.hotkey", "message": f"Hotkey {hk} is used by {first!r} too."}
                )
            else:
                hotkeys[hk] = i
    if errors:
        raise invalid_template(errors)


def _clean_name(name: str) -> tuple[str, str]:
    clean = " ".join(name.split())
    key = normalise_name(clean)
    if not key:
        raise invalid_template([{"path": "name", "message": "A template name cannot be blank."}])
    return clean, key


def _refuse_taken(s, key: str, exclude: str | None = None) -> None:
    q = select(ProjectTemplate).where(ProjectTemplate.name_key == key)
    if exclude:
        q = q.where(ProjectTemplate.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "template_name_taken",
            f"There is already a template called {holder.name}.",
            409,
            {"template_id": holder.id},
        )


def _refuse_builtin(row: ProjectTemplate) -> None:
    if row.builtin:
        raise AppError(
            "template_builtin",
            f"{row.name} is a built-in template; save a copy under a new name instead.",
            409,
            {"template_id": row.id},
        )


def _row(s, template_id: str) -> ProjectTemplate:
    row = s.get(ProjectTemplate, template_id)
    if row is None:
        raise not_found("project template", template_id)
    return row


def to_out(row: ProjectTemplate) -> ProjectTemplateOut:
    return ProjectTemplateOut(
        id=row.id,
        name=row.name,
        description=row.description or "",
        builtin=bool(row.builtin),
        config=TemplateConfig.model_validate(row.config),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_templates(cat: CatalogueHandle) -> list[ProjectTemplateOut]:
    """Built-ins first, then by name (Ruling 11). A row this version cannot read is left out."""
    with cat.session() as s:
        rows = (
            s.execute(
                select(ProjectTemplate)
                .order_by(ProjectTemplate.builtin.desc(), ProjectTemplate.name_key, ProjectTemplate.id)
                .limit(LIST_CAP)
            )
            .scalars()
            .all()
        )
        out: list[ProjectTemplateOut] = []
        for row in rows:
            try:
                out.append(to_out(row))
            except ValidationError:
                log.warning("project template %s has a config this version cannot read; left out", row.id)
        return out


def create_template(cat: CatalogueHandle, body: ProjectTemplateCreate) -> ProjectTemplateOut:
    name, key = _clean_name(body.name)
    validate_config(body.config)
    try:
        with cat.session() as s:
            _refuse_taken(s, key)
            row = ProjectTemplate(
                id=new_id(),
                name=name,
                name_key=key,
                description=(body.description or "").strip(),
                builtin=False,
                config=body.config.model_dump(mode="json"),  # SlotMatch drops its unset keys (S-R8)
            )
            s.add(row)
            s.flush()
            return to_out(row)
    except IntegrityError as e:  # a concurrent save of the same name won the race
        raise AppError("template_name_taken", f"There is already a template called {name}.", 409) from e


def patch_template(cat: CatalogueHandle, template_id: str, body: ProjectTemplatePatch) -> ProjectTemplateOut:
    fields = body.model_dump(exclude_unset=True)
    try:
        with cat.session() as s:
            row = _row(s, template_id)
            _refuse_builtin(row)
            if fields.get("name") is not None:
                name, key = _clean_name(fields["name"])
                _refuse_taken(s, key, exclude=row.id)
                row.name, row.name_key = name, key
            if fields.get("description") is not None:
                row.description = fields["description"].strip()
            if body.config is not None:
                validate_config(body.config)
                row.config = body.config.model_dump(mode="json")
            s.flush()
            return to_out(row)
    except IntegrityError as e:
        raise AppError("template_name_taken", "There is already a template with that name.", 409) from e


def delete_template(cat: CatalogueHandle, template_id: str) -> None:
    with cat.session() as s:
        row = _row(s, template_id)
        _refuse_builtin(row)
        s.delete(row)
