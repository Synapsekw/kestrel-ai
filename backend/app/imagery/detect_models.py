"""A library model resolved to catalogue types for I's detection endpoints (F §7.4, A9).

Ruling R-BP1: `detect` and `detect-batch` refuse only when *no* model class reaches a catalogue
type (spec §11.2 "With none mapped it answers 422 unmapped_classes"); unresolved classes are
skipped like ignored ones. F's `POST /runs` keeps its strict rule. Resolved types join the project
list (F §7.4), exactly as a run does.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.detect import class_maps
from app.errors import AppError
from app.library import service as library
from app.library.catalogue_port import CataloguePort
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle, library_unavailable
from app.projects.service import ProjectHandle


@dataclass(frozen=True)
class ResolvedModel:
    model: LibraryModel
    mapping: dict[str, str | None]  # model class -> catalogue type id | None (ignored); unresolved absent
    unmapped: list[str]
    labels: dict[str, str]  # model class -> project class name: the provider's class_map
    added: list[str]  # type ids this resolution added to the project list


def resolve_model(
    handle: ProjectHandle, lib: LibraryHandle | None, catalogue: CataloguePort, model_id: str
) -> ResolvedModel:
    """Every refusal comes before any work: 503 without a library, 404 for an unknown model, 409
    `model_unavailable` when its weights file is gone, 422 `unmapped_classes` when nothing maps."""
    if lib is None:
        raise library_unavailable()
    model = library.require_ready(lib, model_id)
    mapping, unmapped = class_maps.resolve_for_model(catalogue, model)
    type_ids = [t for t in dict.fromkeys(mapping.values()) if t]
    if not type_ids:
        raise AppError(
            "unmapped_classes",
            f"None of {model.name}'s classes is mapped to a catalogue type.",
            422,
            {"model_id": model.id, "unmapped": unmapped},
        )
    added = catalogue.add_to_project(handle, type_ids)
    with handle.session() as s:
        labels = class_maps.label_map(mapping, list(handle.row(s).classes or [])) or {}
    return ResolvedModel(model, mapping, unmapped, labels, added)
