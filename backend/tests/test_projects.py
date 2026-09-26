import json
from datetime import datetime

from project_factory import new_project

CLASSES = [
    {"name": "excavator", "colour": "#ff0000", "hotkey": "1"},
    {"name": "dump_truck", "colour": "#00ff00", "hotkey": "2"},
]


def _create(client, folder, name="Ahmadia"):
    return new_project(client, folder, name=name, classes=CLASSES)


def test_create_project_makes_folder_layout(client, project_dir):
    p = _create(client, project_dir)
    assert p["name"] == "Ahmadia" and len(p["classes"]) == 2 and p["classes"][0]["order"] == 0
    assert p["folder"] == str(project_dir)
    assert p["preannotation_model_id"] is None
    assert p["import_defaults"]["max_side"] == 4000
    for sub in ("images", "labels", "datasets", "runs", "models", "cache/thumbs"):
        assert (project_dir / sub).is_dir()
    assert (project_dir / "project.db").exists()


def test_create_in_new_folder_creates_it(client, tmp_path):
    folder = tmp_path / "new" / "deep"
    p = _create(client, folder)
    assert (folder / "project.db").exists() and p["folder"] == str(folder)


def test_create_in_folder_with_existing_project_is_409(client, project_dir):
    _create(client, project_dir)
    r = client.post("/api/v1/projects", json={"name": "B", "folder": str(project_dir), "type_ids": []})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_exists"


def test_open_existing_project_returns_same_id(client, project_dir):
    created = _create(client, project_dir, "A")
    opened = client.post("/api/v1/projects/open", json={"folder": str(project_dir)}).json()
    assert opened["id"] == created["id"]
    assert client.get(f"/api/v1/projects/{created['id']}").json()["name"] == "A"


def test_open_missing_folder_is_404(client, tmp_path):
    r = client.post("/api/v1/projects/open", json={"folder": str(tmp_path / "nope")})
    assert r.status_code == 404


def test_recent_projects_listed(client, project_dir):
    _create(client, project_dir, "A")
    r = client.get("/api/v1/projects")
    assert [p["name"] for p in r.json()["items"]] == ["A"]
    assert r.json()["next_cursor"] is None


def test_forgetting_a_project_drops_it_from_the_recent_list_and_keeps_the_folder(client, project_dir):
    created = _create(client, project_dir, "A")
    r = client.delete(f"/api/v1/projects/{created['id']}")
    assert r.status_code == 204, r.text
    assert client.get("/api/v1/projects").json()["items"] == []
    assert (project_dir / "project.db").is_file()
    # Open folder brings it back, with the same id.
    reopened = client.post("/api/v1/projects/open", json={"folder": str(project_dir)})
    assert reopened.status_code == 200 and reopened.json()["id"] == created["id"]
    assert [p["name"] for p in client.get("/api/v1/projects").json()["items"]] == ["A"]
    assert client.delete("/api/v1/projects/nope").status_code == 404


def test_recent_skips_deleted_folders(client, project_dir, tmp_path):
    import shutil

    gone = tmp_path / "gone"
    gone.mkdir()
    _create(client, gone, "Gone")
    _create(client, project_dir, "A")
    client.app.state.projects.close_all()  # release the SQLite handles before deleting the folder
    shutil.rmtree(gone)
    r = client.get("/api/v1/projects")
    assert [p["name"] for p in r.json()["items"]] == ["A"]


def test_get_project_survives_registry_restart(settings, project_dir):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as c:
        pid = _create(c, project_dir, "A")["id"]
    with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as c:
        assert c.get(f"/api/v1/projects/{pid}").json()["name"] == "A"


def test_update_classes_reorders_and_keeps_ids(client, project_dir):
    p = _create(client, project_dir, "A")
    new = [dict(p["classes"][1], hotkey="9"), p["classes"][0]]
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=new)
    assert r.status_code == 200
    assert [c["name"] for c in r.json()["classes"]] == ["dump_truck", "excavator"]
    assert r.json()["classes"][0]["id"] == p["classes"][1]["id"]
    assert r.json()["classes"][0]["hotkey"] == "9"
    assert [c["order"] for c in r.json()["classes"]] == [0, 1]


# 409, not 422: these bodies match the schema (no uniqueItems, `\S` is satisfied by characters that
# Python's strip() removes), and the contract's conformance check forbids 422 on schema-valid input.
def test_duplicate_class_name_is_409(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], CLASSES[0]])
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert r.json()["error"]["message"] == "Two classes are called excavator. Class names must be unique."


def test_a_blank_class_name_is_409(client, project_dir):
    p = _create(client, project_dir, "A")
    blank = dict(CLASSES[0], name=chr(0x85))  # not whitespace to the schema's regex, blank to Python
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[blank])
    assert r.status_code == 409 and r.json()["error"]["message"] == "A class name cannot be blank."


def test_duplicate_hotkey_is_409(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], dict(CLASSES[1], hotkey="1")])
    assert r.status_code == 409 and r.json()["error"]["message"] == "Two classes use the hotkey 1."


def test_removing_class_with_boxes_is_409(client, project_dir):
    p = _create(client, project_dir, "A")
    handle = client.app.state.projects.get(p["id"])
    from app.db.models import Box, Image, Source

    with handle.session() as s:
        src = Source(folder="x", site="x")
        s.add(src)
        s.flush()
        img = Image(path="images/x/a.jpg", width=10, height=10, source_id=src.id)
        s.add(img)
        s.flush()
        s.add(
            Box(image_id=img.id, class_id=p["classes"][0]["id"], x=0, y=0, w=1, h=1, provenance_kind="person")
        )
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[p["classes"][1]])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "class_in_use"
    assert r.json()["error"]["details"]["box_count"] == 1


def test_patch_project_name_and_import_defaults(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.patch(f"/api/v1/projects/{p['id']}", json={"name": "B", "import_defaults": {"max_side": 3000}})
    assert r.status_code == 200
    assert r.json()["name"] == "B" and r.json()["import_defaults"]["max_side"] == 3000
    assert r.json()["import_defaults"]["quality"] == 95


def test_project_stats_shape(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.get(f"/api/v1/projects/{p['id']}/stats")
    assert r.status_code == 200
    assert r.json()["image_count"] == 0 and r.json()["capture_time_range"] is None


def test_relative_folder_is_422(client):
    r = client.post("/api/v1/projects", json={"name": "A", "folder": "relative/dir", "type_ids": []})
    assert r.status_code == 422
    r = client.post("/api/v1/projects/open", json={"folder": "."})
    assert r.status_code == 422


def test_recent_order_is_stable_across_listings_and_restarts(settings, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    folders = [tmp_path / n for n in ("a", "b", "c")]
    with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as c:
        for f in folders:
            f.mkdir()
            _create(c, f, f.name)
    with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as c:
        first = [p["name"] for p in c.get("/api/v1/projects").json()["items"]]
        second = [p["name"] for p in c.get("/api/v1/projects").json()["items"]]
    assert first == ["c", "b", "a"] and second == first


def test_folder_spellings_resolve_to_one_project(client, project_dir):
    p = _create(client, project_dir, "A")
    # Windows-only spellings (dot segment, forward slashes, case); the product is Windows-only.
    variants = [str(project_dir) + "\\.", str(project_dir).replace("\\", "/"), str(project_dir).upper()]
    for v in variants:
        r = client.post("/api/v1/projects/open", json={"folder": v})
        assert r.status_code == 200 and r.json()["id"] == p["id"], v
        assert r.json()["folder"] == str(project_dir)
    assert len(client.get("/api/v1/projects").json()["items"]) == 1
    assert len(client.app.state.projects._handles) == 1


# last_opened_at comes from the recent list (AppData), not the project's own row (task 2b).


def _recent_entries(settings) -> list[dict]:
    return json.loads((settings.data_dir / "recent_projects.json").read_text("utf-8"))


def test_last_opened_at_matches_the_recent_entry_on_create_get_and_list(client, settings, project_dir):
    p = _create(client, project_dir, "A")
    expected = datetime.fromisoformat(_recent_entries(settings)[0]["last_opened_at"])
    assert datetime.fromisoformat(p["last_opened_at"]) == expected
    got = client.get(f"/api/v1/projects/{p['id']}").json()["last_opened_at"]
    assert datetime.fromisoformat(got) == expected
    listed = client.get("/api/v1/projects").json()["items"][0]["last_opened_at"]
    assert datetime.fromisoformat(listed) == expected


def test_opening_a_project_again_moves_last_opened_at_forward(client, settings, project_dir):
    p = _create(client, project_dir, "A")
    entries = _recent_entries(settings)
    entries[0]["last_opened_at"] = "2020-01-01T00:00:00+00:00"
    (settings.data_dir / "recent_projects.json").write_text(json.dumps(entries), "utf-8")

    reopened = client.post("/api/v1/projects/open", json={"folder": str(project_dir)}).json()

    assert reopened["id"] == p["id"]
    before = datetime.fromisoformat("2020-01-01T00:00:00+00:00")
    after = datetime.fromisoformat(reopened["last_opened_at"])
    assert after > before


def test_a_project_not_in_the_recent_list_has_null_last_opened_at(client, settings, project_dir):
    p = _create(client, project_dir, "A")
    (settings.data_dir / "recent_projects.json").write_text("[]", "utf-8")

    r = client.get(f"/api/v1/projects/{p['id']}")

    assert r.status_code == 200
    assert r.json()["last_opened_at"] is None


def test_a_malformed_last_opened_at_answers_null_not_500(client, settings, project_dir):
    p = _create(client, project_dir, "A")
    entries = _recent_entries(settings)
    entries[0]["last_opened_at"] = "not-a-timestamp"
    (settings.data_dir / "recent_projects.json").write_text(json.dumps(entries), "utf-8")

    r = client.get(f"/api/v1/projects/{p['id']}")

    assert r.status_code == 200
    assert r.json()["last_opened_at"] is None


def test_a_recent_entry_with_no_last_opened_at_key_answers_null(client, settings, project_dir):
    p = _create(client, project_dir, "A")
    entries = _recent_entries(settings)
    del entries[0]["last_opened_at"]
    (settings.data_dir / "recent_projects.json").write_text(json.dumps(entries), "utf-8")

    r = client.get(f"/api/v1/projects/{p['id']}")

    assert r.status_code == 200
    assert r.json()["last_opened_at"] is None
