"""The catalogue as the models backend sees it (foundation F §7.4 and §12; plan BM Task 2).

The models backend needs four things from the catalogue that unit BC builds: resolve type ids,
match model class names to types by `normalise_name`, create missing types, and put types on a
project's type list. This module is the only place in the models backend that knows where those
come from. Until BC is on main nothing in the app provides a catalogue, so production code sees
`NO_CATALOGUE`, which knows no types; tests install a fake on `app.state.catalogue_port`. Task 11
points `catalogue_of` at BC's catalogue, and no caller changes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from fastapi import Request

from app.errors import AppError

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle

CATALOGUE_UNAVAILABLE = "The catalogue could not be opened."


@dataclass(frozen=True)
class TypeRef:
    id: str
    name: str
    kind: str  # defect | object
    archived: bool = False


class CataloguePort(Protocol):
    def resolve_types(self, type_ids: Iterable[str]) -> dict[str, TypeRef]:
        """The known types among `type_ids`, archived ones included; an unknown id is absent."""
        ...

    def match_names(self, names: Iterable[str]) -> dict[str, TypeRef]:
        """Each name equal to a live (not archived) type's name under `normalise_name`."""
        ...

    def ensure_types(self, names: Iterable[str]) -> dict[str, TypeRef]:
        """Each name's live type, created with kind `object` when none matches."""
        ...

    def add_to_project(self, handle: ProjectHandle, type_ids: list[str]) -> list[str]:
        """Append the types to the project's type list; the ids that were not on it, in order."""
        ...


def catalogue_unavailable() -> AppError:
    return AppError("catalogue_unavailable", CATALOGUE_UNAVAILABLE, 503)


class _NoCatalogue:
    """Before BC: a catalogue that knows no types. Nothing resolves; creating a type is a 503."""

    def resolve_types(self, type_ids: Iterable[str]) -> dict[str, TypeRef]:
        return {}

    def match_names(self, names: Iterable[str]) -> dict[str, TypeRef]:
        return {}

    def ensure_types(self, names: Iterable[str]) -> dict[str, TypeRef]:
        raise catalogue_unavailable()

    def add_to_project(self, handle: ProjectHandle, type_ids: list[str]) -> list[str]:
        return []


NO_CATALOGUE = _NoCatalogue()


def catalogue_of(state) -> CataloguePort:
    """The port on `app.state`: an installed one (tests), else the app's catalogue."""
    port = getattr(state, "catalogue_port", None)
    return port if port is not None else NO_CATALOGUE


def get_catalogue(request: Request) -> CataloguePort:
    """FastAPI dependency: the catalogue port for this app."""
    return catalogue_of(request.app.state)
