"""Creating a project in a test (plans BK and BC; spec 2026-09-26-foundation sections 6.1, 7.3).

A project is created with `{name, folder, type_ids}`. A test that needs classes names them: each
becomes a catalogue type (the existing one when the catalogue already has that name), and the
project's type list is those types in order.
"""

from pathlib import Path

BASE = "/api/v1/projects"
TYPES = "/api/v1/catalogue/types"
DEFAULT_COLOUR = "#4f46e5"


def catalogue_type(client, c: dict) -> str:
    """The catalogue type id for class dict `c` ({name, colour?, hotkey?, kind?, default_severity?,
    group?}). A name clash reuses the existing type; a hotkey clash drops the hotkey."""
    body = {"name": c["name"], "colour": c.get("colour") or DEFAULT_COLOUR, "kind": c.get("kind", "object")}
    for key in ("hotkey", "default_severity", "group"):
        if c.get(key) is not None:
            body[key] = c[key]
    r = client.post(TYPES, json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "hotkey_conflict":
        body.pop("hotkey")
        r = client.post(TYPES, json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "type_exists":
        return r.json()["error"]["details"]["type_id"]
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_project(client, folder: Path, *, name: str = "T", classes: list[dict] | None = None) -> dict:
    type_ids = list(dict.fromkeys(catalogue_type(client, c) for c in classes or []))
    r = client.post(BASE, json={"name": name, "folder": str(folder), "type_ids": type_ids})
    assert r.status_code == 201, r.text
    return r.json()
