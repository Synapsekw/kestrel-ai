"""The catalogue as the models backend sees it (foundation F §7.4 and §12; plan BM Task 2).

The models backend needs four things from the catalogue that unit BC builds: resolve type ids,
match model class names to types by `normalise_name`, create missing types, and put types on a
project's type list. This module is the only place in the models backend that knows where those
come from.

Tests may install a port on app.state.catalogue_port; otherwise the app's catalogue (BC's
CatalogueHandle) is wrapped in CatalogueAdapter, the only place in the models backend that imports
app.catalogue.
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


class CatalogueAdapter:
    """BC's catalogue behind this port. The only place in the models backend that imports
    `app.catalogue`; if BC renames a function, only the matching method body here changes."""

    def __init__(self, handle):
        self.handle = handle

    @staticmethod
    def _ref(t) -> TypeRef:
        return TypeRef(id=t.id, name=t.name, kind=t.kind, archived=bool(t.archived))

    def resolve_types(self, type_ids: Iterable[str]) -> dict[str, TypeRef]:
        from app.catalogue import service as catalogue

        return {i: self._ref(t) for i, t in catalogue.resolve_types(self.handle, list(type_ids)).items()}

    def match_names(self, names: Iterable[str]) -> dict[str, TypeRef]:
        from app.catalogue import service as catalogue

        return {n: self._ref(t) for n, t in catalogue.find_by_names(self.handle, list(names)).items()}

    def ensure_types(self, names: Iterable[str]) -> dict[str, TypeRef]:
        from app.catalogue import service as catalogue

        made = catalogue.ensure_types(self.handle, list(names), kind="object")
        return {n: self._ref(t) for n, t in made.items()}

    def add_to_project(self, handle: ProjectHandle, type_ids: list[str]) -> list[str]:
        from app.catalogue.service import add_project_types

        return add_project_types(handle, self.handle, list(type_ids))


def catalogue_of(state) -> CataloguePort:
    """An installed port (tests), else BC's catalogue; 503 `catalogue_unavailable` when it failed
    to open (foundation F §15)."""
    port = getattr(state, "catalogue_port", None)
    if port is not None:
        return port
    handle = getattr(state, "catalogue", None)
    if handle is None:
        raise catalogue_unavailable()
    return CatalogueAdapter(handle)


def get_catalogue(request: Request) -> CataloguePort:
    """FastAPI dependency: the catalogue port for this app."""
    return catalogue_of(request.app.state)
