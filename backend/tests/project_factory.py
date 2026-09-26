"""Creating a project in a test (plan BK; spec 2026-09-26-foundation section 6.1).

A project is created with `{name, folder, type_ids}`: no kind and no classes. Until unit BC lands
the project type list, a test that needs classes writes them straight into the project row with the
normalisation `PUT /projects/{id}/classes` uses. BC changes only this helper.
"""

from pathlib import Path

from app.projects.service import normalise_classes

BASE = "/api/v1/projects"


def new_project(client, folder: Path, *, name: str = "T", classes: list[dict] | None = None) -> dict:
    r = client.post(BASE, json={"name": name, "folder": str(folder), "type_ids": []})
    assert r.status_code == 201, r.text
    project = r.json()
    if classes:
        handle = client.app.state.projects.get(project["id"])
        with handle.session() as s:
            handle.row(s).classes = normalise_classes(classes)
        project = client.get(f"{BASE}/{project['id']}").json()
    return project
