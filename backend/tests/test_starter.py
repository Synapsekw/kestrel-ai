from pathlib import Path

import pytest

from app.errors import AppError
from app.training import starter


@pytest.fixture
def folder(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "starter_weights"
    d.mkdir()
    (d / "yolo11n.pt").write_bytes(b"x" * 2_000_000)
    monkeypatch.setattr("app.training.registry.read_class_names", lambda path: ["person", "truck"])
    return d


def test_the_catalogue_lists_three_sizes_smallest_first_and_marks_missing_files(folder):
    items = starter.list_starters(folder)
    assert [i["key"] for i in items] == ["yolo11n", "yolo11s", "yolo11m"]
    assert items[0]["available"] is True and items[0]["size_mb"] == pytest.approx(1.9, abs=0.1)
    assert items[1]["available"] is False and items[1]["size_mb"] == 0
    assert all(i["name"] and i["description"] for i in items)


def test_import_registers_an_imported_model_with_the_truck_alias(handle, folder):
    row = starter.import_starter(handle, folder, "yolo11n", None)
    assert row.kind == "imported" and row.name == "yolo11n-coco"
    assert row.class_aliases == {"truck": "dump_truck"}  # the default project has dump_truck
    assert (handle.folder / row.weights_path).is_file()
    assert (folder / "yolo11n.pt").is_file()  # the bundled file stays


def test_import_without_a_dump_truck_class_sets_no_alias(handle, folder, monkeypatch):
    monkeypatch.setattr(starter, "project_class_names", lambda h: ["excavator"])
    assert starter.import_starter(handle, folder, "yolo11n", "mine").class_aliases == {}


def test_a_missing_file_is_a_404_that_names_the_fix(handle, folder):
    with pytest.raises(AppError) as e:
        starter.import_starter(handle, folder, "yolo11m", None)
    assert e.value.status == 404
    assert e.value.message == "The starter model yolo11m is not included in this copy of the app."


def test_weights_dir_prefers_the_setting_then_the_frozen_bundle_then_the_checkout(
    tmp_path, monkeypatch, settings
):
    assert starter.weights_dir(settings.model_copy(update={"starter_weights_dir": tmp_path})) == tmp_path
    # The `settings` fixture pins starter_weights_dir (for hermeticity elsewhere); None here
    # exercises the frozen-bundle and checkout fallbacks this function falls through to.
    unset = settings.model_copy(update={"starter_weights_dir": None})
    monkeypatch.setattr("sys._MEIPASS", str(tmp_path / "bundle"), raising=False)
    monkeypatch.setattr("sys.frozen", True, raising=False)
    assert starter.weights_dir(unset) == tmp_path / "bundle" / "starter_weights"
    monkeypatch.setattr("sys.frozen", False, raising=False)
    assert starter.weights_dir(unset).name == "starter_weights"
    assert starter.weights_dir(unset).parent.name == "backend"


def test_weights_dir_falls_back_to_the_checkout_if_a_frozen_process_somehow_has_no_meipass(
    monkeypatch, settings
):
    """`_MEIPASS` is always set by a real PyInstaller bundle; this only guards a getattr, never a crash."""
    unset = settings.model_copy(update={"starter_weights_dir": None})
    monkeypatch.delattr("sys._MEIPASS", raising=False)
    monkeypatch.setattr("sys.frozen", True, raising=False)
    result = starter.weights_dir(unset)
    assert result.name == "starter_weights"
    assert result.parent.name == "backend"


def test_the_api_lists_and_imports(client, project_id, folder, monkeypatch):
    monkeypatch.setattr(starter, "weights_dir", lambda settings: folder)
    r = client.get("/api/v1/starter-models")
    assert r.status_code == 200, r.text
    assert [i["available"] for i in r.json()["items"]] == [True, False, False]
    assert r.json()["next_cursor"] is None

    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo11n"})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "imported" and r.json()["name"] == "yolo11n-coco"

    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo11m"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.post(f"/api/v1/projects/{project_id}/models/import-starter", json={"key": "yolo99"})
    assert r.status_code == 422
