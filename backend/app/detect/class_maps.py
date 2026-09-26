"""A library model's classes mapped onto a project's classes (spec 2026-09-23 section 7.3).

A mapping is `{model_class_name: project_class_id | None}`; `None` ignores that class, so its
detections are never written. Per model class the order is:

1. the project's remembered `ModelClassMap` entry (when it still names a project class, or is None);
2. an exact name match against the project's classes;
3. the model's `class_aliases` value, when it names a project class.

Anything left is *unmapped*. A run is refused while anything is unmapped, before a job is queued.
The one exception is a project with no classes at all: its first run seeds the class list from the
model (`seed=True`) and maps every class to itself.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import ModelClassMap
from app.errors import AppError
from app.library.db import LibraryModel
from app.projects.service import ProjectHandle, normalise_classes

# The app's standard class palette (the same one the project agent cycles through).
PALETTE = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]
HOTKEYS = [str(i) for i in range(1, 10)]

Mapping = dict[str, str | None]


def _stored(s: Session, model_id: str) -> Mapping:
    row = s.get(ModelClassMap, model_id)
    return dict(row.mapping or {}) if row is not None else {}


def _resolve(classes: list[dict], stored: Mapping, model: LibraryModel) -> tuple[Mapping, list[str]]:
    by_name = {c["name"]: c["id"] for c in classes}
    ids = set(by_name.values())
    aliases = model.class_aliases or {}
    mapping: Mapping = {}
    unmapped: list[str] = []
    for name in model.class_names or []:
        if name in stored and (stored[name] is None or stored[name] in ids):
            mapping[name] = stored[name]
        elif name in by_name:
            mapping[name] = by_name[name]
        elif aliases.get(name) in by_name:
            mapping[name] = by_name[aliases[name]]
        else:
            unmapped.append(name)
    return mapping, unmapped


def append_classes(s: Session, handle: ProjectHandle, names: list[str]) -> dict[str, str]:
    """Add each name as a project class unless one of that name exists; `{name: class_id}` for all.

    New classes take the next palette colour and the next free digit hotkey. Called inside the
    caller's session, so the class list and whatever maps onto it change together.
    """
    row = handle.row(s)
    classes = [dict(c) for c in row.classes or []]
    existing = {c["name"] for c in classes}
    used = {c.get("hotkey") for c in classes if c.get("hotkey")}
    for name in names:
        name = name.strip()
        if not name or name in existing:
            continue
        hotkey = next((k for k in HOTKEYS if k not in used), None)
        if hotkey:
            used.add(hotkey)
        classes.append({"name": name, "colour": PALETTE[len(classes) % len(PALETTE)], "hotkey": hotkey})
        existing.add(name)
    row.classes = normalise_classes(classes)
    s.flush()
    return {c["name"]: c["id"] for c in row.classes}


def resolve(handle: ProjectHandle, model: LibraryModel, *, seed: bool = False) -> tuple[Mapping, list[str]]:
    """`(mapping, unmapped)` for this model in this project, unmapped in the model's class order.

    With `seed`, a project that has no classes yet takes the model's classes as its class list
    first, so everything maps. Only run creation seeds; reading a mapping never writes.
    """
    with handle.session() as s:
        classes = list(handle.row(s).classes or [])
        if seed and not classes and model.class_names:
            append_classes(s, handle, list(model.class_names))
            classes = list(handle.row(s).classes or [])
        return _resolve(classes, _stored(s, model.id), model)


def put(handle: ProjectHandle, model: LibraryModel, mapping: Mapping, new_classes: list[str]) -> None:
    """Remember a mapping for this model, merged over what was remembered before.

    Every key must be one of the model's classes and every id a project class (422 otherwise).
    Each `new_classes` name is added as a project class (or reuses the class of that name) and is
    mapped to it. The class list and the mapping are written in one transaction.
    """
    model_classes = set(model.class_names or [])
    bad_names = sorted((set(mapping) | set(new_classes)) - model_classes)
    if bad_names:
        raise AppError(
            "validation_error",
            f"not classes of model {model.name}: {', '.join(bad_names)}",
            422,
            {"names": bad_names},
        )
    with handle.session() as s:
        ids = {c["id"] for c in handle.row(s).classes or []}
        bad_ids = sorted({v for v in mapping.values() if v is not None and v not in ids})
        if bad_ids:
            raise AppError(
                "validation_error",
                f"not project classes: {', '.join(bad_ids)}",
                422,
                {"class_ids": bad_ids},
            )
        merged = {**_stored(s, model.id), **mapping}
        if new_classes:
            by_name = append_classes(s, handle, new_classes)
            merged.update({name: by_name[name.strip()] for name in new_classes})
        row = s.get(ModelClassMap, model.id)
        if row is None:
            s.add(ModelClassMap(library_model_id=model.id, mapping=merged))
        else:
            row.mapping = merged


def label_map(run_class_map: Mapping | None, classes: list[dict]) -> dict[str, str] | None:
    """A run's `{model class: project class id | None}` as the provider's `{model class: project
    class name}`. Ignored classes and ids no longer in the project are left out, so the provider
    drops them. None when the run has no mapping of its own (older runs, cloud runs)."""
    if not run_class_map:
        return None
    names = {c["id"]: c["name"] for c in classes}
    return {model: names[cid] for model, cid in run_class_map.items() if cid is not None and cid in names}


def model_snapshot(model: LibraryModel) -> dict:
    """The library model as it is now, kept on a run so the run reads after the model is gone."""
    return {
        "id": model.id,
        "name": model.name,
        "task": model.task,
        "format": model.format,
        "class_names": list(model.class_names or []),
        "origin": model.origin,
    }
