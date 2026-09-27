"""The project type list (spec 2026-09-26-foundation section 7.3): ordered catalogue types with a
snapshot each, served as `Project.classes`, refreshed from the catalogue, and still readable when the
catalogue is down (decision F2)."""

import pytest
from conftest import EIGHT_CLASSES
from findings_helpers import add_type, insert_box, use_types
from migration_helpers import arm

from app.catalogue import project_types
from app.catalogue import service as catalogue
from app.db.models import Box, Finding, Image, Source

API = "/api/v1"


def _classes(client, pid: str) -> list[dict]:
    return client.get(f"{API}/projects/{pid}").json()["classes"]


def _put(client, pid: str, type_ids: list[str], hotkeys: dict | None = None):
    body: dict = {"type_ids": type_ids}
    if hotkeys is not None:
        body["hotkeys"] = hotkeys
    return client.put(f"{API}/projects/{pid}/types", json=body)


def test_a_new_project_lists_its_types_as_classes(project):
    classes = project["classes"]
    assert [c["name"] for c in classes] == EIGHT_CLASSES
    assert [c["order"] for c in classes] == list(range(8))
    first = classes[0]
    assert (first["kind"], first["hotkey"], first["default_severity"], first["group"]) == (
        "object",
        "1",
        None,
        None,
    )


def test_put_types_reorders_and_keeps_ids(client, project):
    ids = [c["id"] for c in project["classes"]]
    r = _put(client, project["id"], list(reversed(ids)))
    assert r.status_code == 200, r.text
    assert [c["id"] for c in r.json()["classes"]] == list(reversed(ids))


def test_a_type_with_annotations_cannot_leave_the_list(client, project, handle):
    ids = [c["id"] for c in project["classes"]]
    with handle.session() as s:
        src = Source(folder="C:/f", site="S")
        s.add(src)
        s.flush()
        img = Image(path="images/a.jpg", width=10, height=10, source_id=src.id)
        s.add(img)
        s.flush()
        s.add(
            Box(
                image_id=img.id,
                class_id=ids[0],
                x=1,
                y=1,
                w=2,
                h=2,
                provenance_kind="person",
                review_state="accepted",
            )
        )
    r = _put(client, project["id"], ids[1:])
    assert r.status_code == 409
    err = r.json()["error"]
    details = err["details"]
    assert (err["code"], details["type_id"], details["box_count"], details["finding_count"]) == (
        "class_in_use",
        ids[0],
        1,
        0,
    )


def test_a_type_with_findings_cannot_leave_the_list(client, project, handle):
    crack = add_type(client, "crack")
    use_types(client, project, crack)
    with handle.session() as s:
        s.add(
            Finding(
                number=1,
                type_id=crack["id"],
                status="open",
                note="",
                created_by="human",
                anchor_kind="cloud",
                cloud_id="c1",
                x=0.0,
                y=0.0,
                z=0.0,
                data_type="point_cloud",
                data_id="c1",
            )
        )
    r = _put(client, project["id"], [c["id"] for c in project["classes"]])
    assert r.status_code == 409
    err = r.json()["error"]
    assert (err["code"], err["details"]["type_id"], err["details"]["finding_count"]) == (
        "class_in_use",
        crack["id"],
        1,
    )


def test_hotkey_overrides_must_not_clash(client, project):
    ids = [c["id"] for c in project["classes"]]
    r = _put(client, project["id"], ids, {ids[1]: "1"})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "hotkey_conflict")
    assert r.json()["error"]["details"]["type_id"] == ids[0]  # the type holding the hotkey
    r = _put(client, project["id"], ids, {ids[0]: "Q"})
    assert r.status_code == 200, r.text
    assert r.json()["classes"][0]["hotkey"] == "q"
    r = _put(client, project["id"], ids)  # no `hotkeys`: overrides stay
    assert r.json()["classes"][0]["hotkey"] == "q"


def test_an_unknown_type_is_422(client, project):
    r = _put(client, project["id"], [c["id"] for c in project["classes"]] + ["nope"])
    assert (r.status_code, r.json()["error"]["code"], r.json()["error"]["details"]) == (
        422,
        "unknown_type",
        {"type_ids": ["nope"]},
    )


def test_catalogue_edits_refresh_open_projects(client, project):
    tid = project["classes"][0]["id"]
    r = client.patch(
        f"{API}/catalogue/types/{tid}", json={"name": "Digger", "colour": "#000000", "kind": "defect"}
    )
    assert r.status_code == 200, r.text
    c = _classes(client, project["id"])[0]
    assert (c["name"], c["colour"], c["kind"]) == ("Digger", "#000000", "defect")


def test_opening_a_project_refreshes_its_snapshot(client, project, handle):
    catalogue.patch_type(client.app.state.catalogue, project["classes"][0]["id"], {"name": "Digger"})
    assert project_types.refresh_handle(handle) == 1
    assert _classes(client, project["id"])[0]["name"] == "Digger"
    assert project_types.refresh_handle(handle) == 0


def test_a_project_renders_from_its_snapshot_without_the_catalogue(client, project, handle):
    client.app.state.catalogue = None
    client.app.state.projects.catalogue = None
    handle.catalogue = None
    assert [c["name"] for c in _classes(client, project["id"])] == EIGHT_CLASSES
    r = _put(client, project["id"], [c["id"] for c in project["classes"]] + ["new-type"])
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")


def test_creating_a_project_with_types_needs_the_catalogue(client, tmp_path):
    client.app.state.projects.catalogue = None
    r = client.post(f"{API}/projects", json={"name": "P", "folder": str(tmp_path / "p2"), "type_ids": ["x"]})
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")
    assert not (tmp_path / "p2").exists()


def test_a_new_project_is_born_at_version_2_once_the_migration_steps_are_armed(client, tmp_path, monkeypatch):
    """Disarmed (MG ships no steps yet) a new project starts at 1 like every other project, so the
    steps still run over it when they arm; armed, it is born at 2 (MG-steps Task 15)."""

    def create(name):
        r = client.post(
            "/api/v1/projects", json={"name": name, "folder": str(tmp_path / name), "type_ids": []}
        )
        assert r.status_code == 201, r.text
        return r.json()["schema_version"]

    arm(monkeypatch)
    assert create("disarmed") == 1
    arm(monkeypatch, object())
    assert create("armed") == 2


def test_the_legacy_class_list_cannot_be_written_through_classes(handle):
    with handle.session() as s, pytest.raises(AttributeError):
        handle.row(s).classes = []


def test_a_pre_foundation_project_shows_its_legacy_classes_until_migrated(handle):
    with handle.session() as s:
        s.query(project_types.ProjectType).delete()
        row = handle.row(s)
        row.schema_version = 1
        row.legacy_classes = [
            {"id": "c1", "name": "excavator", "colour": "#ff0000", "hotkey": "1", "order": 0}
        ]
    with handle.session() as s:
        assert project_types.project_classes(s, legacy=handle.row(s)) == [
            {
                "id": "c1",
                "name": "excavator",
                "colour": "#ff0000",
                "hotkey": "1",
                "order": 0,
                "kind": "object",
                "default_severity": None,
                "group": None,
            }
        ]


def test_a_pre_foundation_project_keeps_its_legacy_classes_once_a_type_row_is_written(client, handle):
    """Until MG migrates it, a v1 project lists its legacy classes followed by any `project_type` row
    (a run's mapped type, a finding's type), so its existing boxes stay editable."""
    from app.imagery import annotations as boxes

    crack = add_type(client, "crack")
    with handle.session() as s:
        s.query(project_types.ProjectType).delete()
        row = handle.row(s)
        row.schema_version = 1
        row.legacy_classes = [
            {"id": "c1", "name": "excavator", "colour": "#ff0000", "hotkey": "1", "order": 0}
        ]
    _, box_id = insert_box(handle, "c1")
    with handle.session() as s:
        project_types.add_types(s, handle.catalogue, [crack["id"]])
    with handle.session() as s:
        classes = handle.row(s).classes
    assert [(c["id"], c["order"]) for c in classes] == [("c1", 0), (crack["id"], 1)]
    assert boxes.update_box(handle, box_id, x=0.4).box.x == 0.4


def test_a_new_project_clears_a_hotkey_clash_in_its_initial_list(client, tmp_path):
    """An archived type may hold the hotkey a live one took since; picking both for a new project
    clears the later one's key for this project, as `add_types` does, instead of a 409 that left a
    half-made folder behind."""
    old = add_type(client, "old crack", hotkey="q")
    client.patch(f"{API}/catalogue/types/{old['id']}", json={"archived": True})
    new = add_type(client, "crack", hotkey="q")
    r = client.post(
        f"{API}/projects",
        json={"name": "P", "folder": str(tmp_path / "p"), "type_ids": [new["id"], old["id"]]},
    )
    assert r.status_code == 201, r.text
    assert [(c["id"], c["hotkey"]) for c in r.json()["classes"]] == [(new["id"], "q"), (old["id"], None)]


def test_a_failed_create_leaves_no_project_behind(client, tmp_path, monkeypatch):
    registry = client.app.state.projects
    folder = tmp_path / "p"

    def boom(*a, **kw):
        raise RuntimeError("disk trouble")

    with monkeypatch.context() as m:
        m.setattr(project_types, "add_types", boom)
        m.setattr(project_types, "set_types", boom)
        with pytest.raises(RuntimeError):
            registry.create("P", folder, [])
    assert not folder.exists()
    kept = tmp_path / "kept"
    (kept / "images").mkdir(parents=True)
    (kept / "images" / "a.jpg").write_bytes(b"x")
    with monkeypatch.context() as m:
        m.setattr(project_types, "add_types", boom)
        m.setattr(project_types, "set_types", boom)
        with pytest.raises(RuntimeError):
            registry.create("P", kept, [])
    assert sorted(p.relative_to(kept).as_posix() for p in kept.rglob("*")) == ["images", "images/a.jpg"]
    assert registry.create("P", folder, []).folder == folder.resolve()
