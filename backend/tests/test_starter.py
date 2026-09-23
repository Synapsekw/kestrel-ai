from pathlib import Path

import pytest
from library_helpers import stub_checkpoint

from app.errors import AppError
from app.library import service as library
from app.training import starter


@pytest.fixture
def folder(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "starter_weights"
    d.mkdir()
    (d / "yolo11n.pt").write_bytes(b"x" * 2_000_000)
    stub_checkpoint(monkeypatch, names=["person", "truck"])
    return d


@pytest.fixture
def lib(client, app):
    return app.state.library


def test_the_catalogue_marks_local_weights_and_missing_files(folder):
    items = starter.list_starters(folder)
    assert [i["key"] for i in items[:3]] == ["yolo11n", "yolo11s", "yolo11m"]
    assert items[0]["available"] is True and items[0]["size_mb"] == pytest.approx(1.9, abs=0.1)
    assert items[1]["available"] is False and items[1]["size_mb"] == 0
    assert all(i["name"] and i["description"] for i in items)


def test_import_adds_a_starter_model_to_the_library_with_the_truck_alias(lib, folder):
    row = starter.import_starter(lib, folder, "yolo11n", None)
    assert row.origin == "starter" and row.name == "yolo11n-coco"
    assert row.class_names == ["person", "truck"]
    assert row.class_aliases == {"truck": "dump_truck"}  # never filtered by a project's classes
    assert library.weights_file(lib, row).is_file()
    assert (folder / "yolo11n.pt").is_file()  # the bundled file stays


def test_a_model_without_a_truck_class_gets_no_alias(lib, folder, monkeypatch):
    stub_checkpoint(monkeypatch, names=["person", "car"])
    assert starter.import_starter(lib, folder, "yolo11n", "mine").class_aliases == {}


def test_importing_the_same_starter_again_returns_the_library_model(lib, folder):
    first = starter.import_starter(lib, folder, "yolo11n", None)
    assert starter.import_starter(lib, folder, "yolo11n", "other name").id == first.id


def test_a_missing_file_is_a_404_that_names_the_fix(lib, folder):
    with pytest.raises(AppError) as e:
        starter.import_starter(lib, folder, "yolo11m", None)
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


def test_the_api_lists_the_catalogue(client, folder, monkeypatch):
    monkeypatch.setattr(starter, "weights_dir", lambda settings: folder)
    r = client.get("/api/v1/starter-models")
    assert r.status_code == 200, r.text
    assert sum(i["available"] for i in r.json()["items"]) == 1
    assert r.json()["next_cursor"] is None


def test_catalogue_covers_compatible_coco_detection_families_without_loading_weights(folder):
    items = starter.list_starters(folder)
    keys = {i["key"] for i in items}
    expected = {
        f"{prefix}{scale}" for prefix in ("yolo26", "yolo12", "yolo11", "yolov8") for scale in "nsmlx"
    }
    expected |= {f"yolov10{s}" for s in "nsmblx"}
    expected |= {f"yolov9{s}" for s in "tsmce"}
    expected |= {f"yolov5{s}{suffix}" for s in "nsmlx" for suffix in ("u", "6u")}
    expected |= {"yolov3u", "yolov3-tinyu", "yolov3-sppu"}
    assert keys == expected
    assert all(i["task"] == "detect" and i["family"] for i in items)
