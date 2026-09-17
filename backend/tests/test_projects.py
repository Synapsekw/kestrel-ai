CLASSES = [
    {"name": "excavator", "colour": "#ff0000", "hotkey": "1"},
    {"name": "dump_truck", "colour": "#00ff00", "hotkey": "2"},
]


def _create(client, folder, name="Ahmadia"):
    r = client.post("/api/v1/projects", json={"name": name, "folder": str(folder), "classes": CLASSES})
    assert r.status_code == 201, r.text
    return r.json()


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
    r = client.post("/api/v1/projects", json={"name": "B", "folder": str(project_dir), "classes": []})
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


def test_recent_skips_deleted_folders(client, project_dir, tmp_path):
    import shutil

    gone = tmp_path / "gone"
    gone.mkdir()
    _create(client, gone, "Gone")
    _create(client, project_dir, "A")
    from app.projects.service import ProjectRegistry  # noqa: F401  (close handles before deleting)

    client.app.state.projects.close_all()
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


def test_duplicate_class_name_is_422(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], CLASSES[0]])
    assert r.status_code == 422


def test_duplicate_hotkey_is_422(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], dict(CLASSES[1], hotkey="1")])
    assert r.status_code == 422


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
    r = client.post("/api/v1/projects", json={"name": "A", "folder": "relative/dir", "classes": []})
    assert r.status_code == 422
    r = client.post("/api/v1/projects/open", json={"folder": "."})
    assert r.status_code == 422
