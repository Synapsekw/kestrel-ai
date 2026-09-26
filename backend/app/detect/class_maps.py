"""A library model's classes mapped onto catalogue types (foundation F §7.4 and F10).

The mapping is app-wide and lives on the model: `library_model.class_map` is `{model class name:
catalogue type id | None}`, and `None` ignores that class, so its detections are never written.
`resolve_for_model` fills the gaps from the catalogue by name, then by the model's aliases.
Anything left is *unmapped*, and a run is refused while anything is unmapped, before a job is
queued. A mapped type the project does not list yet is added to its type list when a run starts
(`runs.create_runs`).
"""

from __future__ import annotations

from collections.abc import Iterable

from app.errors import AppError
from app.library import service as library
from app.library.catalogue_port import CataloguePort
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle

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
