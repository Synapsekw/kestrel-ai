"""Shared helpers for the catalogue and finding tests (plan BC)."""

API = "/api/v1"


def add_type(client, name: str, *, kind: str = "defect", **body) -> dict:
    """A catalogue type, created through the API."""
    r = client.post(f"{API}/catalogue/types", json={"name": name, "kind": kind, **body})
    assert r.status_code == 201, r.text
    return r.json()


def use_types(client, project: dict, *types: dict) -> dict:
    """Append `types` to the project's type list; returns the updated project."""
    current = [c["id"] for c in client.get(f"{API}/projects/{project['id']}").json()["classes"]]
    r = client.put(
        f"{API}/projects/{project['id']}/types", json={"type_ids": current + [t["id"] for t in types]}
    )
    assert r.status_code == 200, r.text
    return r.json()
