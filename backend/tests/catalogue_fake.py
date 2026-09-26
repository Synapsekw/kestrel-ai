"""An in-memory catalogue behind the models backend's port (plan BM Task 2), and `create_type`, a
real catalogue type through BC's API (Task 11).

Tests install the fake on `app.state.catalogue_port`. Import the fixtures into a test module by name
(`from catalogue_fake import catalogue  # noqa: F401`) - conftest.py is shared with BK and BC, so
BM keeps its fixtures here. After BC, a project's type list is BC's `project_type` table, which only
the real catalogue writes: the fake serves the dataset tests, which never touch type lists.
"""

import pytest

from app.catalogue.service import normalise_name  # noqa: F401 - re-exported for tests
from app.library.catalogue_port import TypeRef


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


def create_type(client, name: str, kind: str = "object") -> dict:
    """A real catalogue type through BC's API (after Task 11)."""
    r = client.post("/api/v1/catalogue/types", json={"name": name, "colour": "#3b82f6", "kind": kind})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def catalogue(app) -> FakeCatalogue:
    """An empty fake catalogue installed on the app."""
    fake = FakeCatalogue()
    app.state.catalogue_port = fake
    return fake
