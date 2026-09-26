"""An in-memory catalogue behind the models backend's port (plan BM Task 2).

Tests install it on `app.state.catalogue_port`. Import the fixtures into a test module by name
(`from catalogue_fake import catalogue  # noqa: F401`) - conftest.py is shared with BK and BC, so
BM keeps its fixtures here.
"""

import re

import pytest

from app.library.catalogue_port import TypeRef
from app.projects.service import normalise_classes


def normalise_name(name: str) -> str:
    """Foundation F §7.1: casefold, trim, `_` and `-` become spaces, runs of spaces collapse."""
    return re.sub(r"\s+", " ", re.sub(r"[_-]", " ", name.casefold())).strip()


class FakeCatalogue:
    def __init__(self):
        self.types: dict[str, TypeRef] = {}

    @classmethod
    def from_classes(cls, classes: list[dict]) -> "FakeCatalogue":
        """A catalogue that knows a project's classes under their own ids."""
        fake = cls()
        for c in classes:
            fake.add(c["name"], type_id=c["id"])
        return fake

    def add(
        self, name: str, *, type_id: str | None = None, kind: str = "object", archived: bool = False
    ) -> TypeRef:
        ref = TypeRef(id=type_id or f"type-{len(self.types) + 1}", name=name, kind=kind, archived=archived)
        self.types[ref.id] = ref
        return ref

    def resolve_types(self, type_ids) -> dict[str, TypeRef]:
        return {i: self.types[i] for i in type_ids if i in self.types}

    def match_names(self, names) -> dict[str, TypeRef]:
        live = {normalise_name(t.name): t for t in self.types.values() if not t.archived}
        return {n: live[normalise_name(n)] for n in names if normalise_name(n) in live}

    def ensure_types(self, names) -> dict[str, TypeRef]:
        out: dict[str, TypeRef] = {}
        for name in (n.strip() for n in names):
            if name:
                out[name] = self.match_names([name]).get(name) or self.add(name)
        return out

    def add_to_project(self, handle, type_ids: list[str]) -> list[str]:
        """Before BC, a project's type list is its `classes` JSON; a type id is used as the class id."""
        with handle.session() as s:
            row = handle.row(s)
            classes = [dict(c) for c in row.classes or []]
            have = {c["id"] for c in classes}
            new = [t for t in dict.fromkeys(type_ids) if t not in have]
            if new:
                classes += [{"id": t, "name": self.types[t].name} for t in new]
                row.classes = normalise_classes(classes)
            return new


@pytest.fixture
def catalogue(app) -> FakeCatalogue:
    """An empty fake catalogue installed on the app."""
    fake = FakeCatalogue()
    app.state.catalogue_port = fake
    return fake


@pytest.fixture
def project_catalogue(app, project) -> FakeCatalogue:
    """A fake catalogue that knows the `project` fixture's classes under their own ids."""
    fake = FakeCatalogue.from_classes(project["classes"])
    app.state.catalogue_port = fake
    return fake
