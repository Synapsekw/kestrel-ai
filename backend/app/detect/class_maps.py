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

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.db.models import ModelClassMap
from app.errors import AppError
from app.library import service as library
from app.library.catalogue_port import CataloguePort
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle
from app.projects.service import ProjectHandle

Mapping = dict[str, str | None]


def resolve_for_model(catalogue: CataloguePort, model: LibraryModel) -> tuple[Mapping, list[str]]:
    """`(mapping, unmapped)` for a model against the catalogue, unmapped in the model's class order.

    Per class: an exact `normalise_name` match against a live catalogue type, then the model's
    `class_aliases` value matched the same way, then the stored `class_map` entry (when None, or a
    live, unarchived catalogue type). Name resolution comes first because the catalogue is the
    shared ground truth: a class whose name matches a type resolves by name even when the stored
    map says otherwise (spec §7.4).
    """
    names = list(model.class_names or [])
    aliases = model.class_aliases or {}
    stored = dict(model.class_map or {})
    by_name = catalogue.match_names(names)
    by_alias = catalogue.match_names([aliases[n] for n in names if aliases.get(n)])
    known = catalogue.resolve_types([v for v in stored.values() if v])
    mapping: Mapping = {}
    unmapped: list[str] = []
    for name in names:
        if name in by_name:
            mapping[name] = by_name[name].id
        elif aliases.get(name) in by_alias:
            mapping[name] = by_alias[aliases[name]].id
        elif name in stored and (
            stored[name] is None or (stored[name] in known and not known[stored[name]].archived)
        ):
            mapping[name] = stored[name]
        else:
            unmapped.append(name)
    return mapping, unmapped


def put_map(
    lib: LibraryHandle,
    catalogue: CataloguePort,
    model_id: str,
    mapping: Mapping,
    new_types: Iterable[str] = (),
) -> LibraryModel:
    """Merge `mapping` over the model's stored map and save it; the saved model.

    Every key must be one of the model's classes (422 `validation_error` otherwise) and every id a
    live, unarchived catalogue type (422 `unknown_type` otherwise). Each `new_types` name maps to
    the catalogue type of that name, created as `object` when the catalogue has none (the
    per-project route's `new_classes`).
    """
    model = library.get_model(lib, model_id)
    new_types = [n.strip() for n in new_types if n.strip()]
    bad_names = sorted((set(mapping) | set(new_types)) - set(model.class_names or []))
    if bad_names:
        raise AppError(
            "validation_error",
            f"not classes of model {model.name}: {', '.join(bad_names)}",
            422,
            {"names": bad_names},
        )
    ids = {v for v in mapping.values() if v is not None}
    known = catalogue.resolve_types(ids)
    bad_ids = sorted(i for i in ids if i not in known or known[i].archived)
    if bad_ids:
        raise AppError(
            "unknown_type",
            f"not usable catalogue types: {', '.join(bad_ids)}",
            422,
            {"type_ids": bad_ids},
        )
    merged = {**(model.class_map or {}), **mapping}
    if new_types:
        created = catalogue.ensure_types(new_types)
        merged.update({name: created[name].id for name in new_types})
    return library.set_class_map(lib, model.id, merged)


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
    """Add each name to the project's type list, resolved against the catalogue by normalise_name
    (a missing name becomes a new `object` type, spec 2026-09-26-foundation section 7.3); returns
    `{name: type_id}` for the list and for every requested name. Called inside the caller's
    session, so the list and whatever maps onto it change together."""
    from app.catalogue import project_types

    return project_types.append_by_names(s, handle.catalogue, [n.strip() for n in names if n.strip()])


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
