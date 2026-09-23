"""Jobs that fill and use the library: training, export, starters, and runs that load a library
model (spec sections 4.3 and 4.4). The FakeTrainer stands in for Ultralytics; no test loads torch
except the one real-checkpoint import, which is skipped when `yolo11n.pt` is absent."""

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fakes import FakeTrainer
from library_helpers import LIB, add_library_model, stub_checkpoint, wait_library_job
from local_paths import MODELS_DIR
from test_training_jobs import make_dataset, wait_for

from app.library import service
from app.training import starter

BASE = "/api/v1/projects"
_CANDIDATES = [
    MODELS_DIR / "yolo11n.pt",
    Path(__file__).resolve().parents[1] / "starter_weights" / "yolo11n.pt",
]
YOLO11N = next((p for p in _CANDIDATES if p.is_file()), _CANDIDATES[-1])


@pytest.fixture
def fake_trainer(monkeypatch) -> FakeTrainer:
    trainer = FakeTrainer(map50=0.61)
    monkeypatch.setattr("app.training.jobs.get_trainer", lambda: trainer)
    monkeypatch.setattr("app.library.jobs.get_trainer", lambda: trainer)
    return trainer


@pytest.fixture
def train_project(client, tmp_path) -> dict:
    body = {"name": "Ahmadia", "folder": str(tmp_path / "train-proj"), "classes": [], "kind": "train"}
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def train_body(dataset_id: str, base_model_id: str, **over) -> dict:
    return {
        "name": "ahmadia v1 n",
        "dataset_id": dataset_id,
        "base_model_id": base_model_id,
        "epochs": 3,
        "imgsz": 640,
        "augmentation": "aerial",
        "device": "cpu",
        **over,
    }


# ------------------------------------------------------------------------ train


def test_a_finished_training_run_is_registered_in_the_library(
    client, app, tmp_path, train_project, fake_trainer
):
    handle = app.state.projects.get(train_project["id"])
    dataset = make_dataset(handle)
    base = add_library_model(app, tmp_path, name="yolo11n-coco", origin="starter")

    r = client.post(f"{BASE}/{train_project['id']}/train", json=train_body(dataset.id, base.id))
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == "train" and job["project_id"] == train_project["id"]
    done = wait_for(client, train_project["id"], job["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"]["metrics"]["map50"] == 0.61

    trained = [m for m in client.get(f"{LIB}/models").json()["items"] if m["origin"] == "trained"]
    assert len(trained) == 1
    m = trained[0]
    assert m["id"] == done["result"]["model_id"]
    assert m["name"] == "ahmadia v1 n" and m["task"] == "detect" and m["state"] == "ready"
    assert m["class_names"] == ["excavator", "dump_truck"]
    assert m["metrics"]["map50"] == 0.61
    assert m["hyperparameters"]["epochs"] == 3 and m["hyperparameters"]["augmentation"] == "aerial"
    assert "base_weights" not in m["hyperparameters"] and "data_yaml" not in m["hyperparameters"]
    p = m["provenance"]
    assert p["project_id"] == train_project["id"]
    assert p["project_name"] == "Ahmadia"
    assert p["project_folder"] == str(handle.folder)
    assert p["dataset_id"] == dataset.id and p["dataset_name"] == "v1"
    assert p["run_id"] == job["id"]
    assert p["base_model_id"] == base.id and p["base_model_name"] == "yolo11n-coco"
    assert set(m["artifacts"]) == {"results_csv", "confusion_matrix"}
    assert m["artifacts"]["results_csv"] == "artifacts/results.csv"
    r = client.get(f"{LIB}/models/{m['id']}/artifacts/results_csv")
    assert r.status_code == 200 and "epoch" in r.text
    # nothing is copied into the project's own models folder any more
    assert list(handle.models_dir.glob("*")) == []


def test_a_run_whose_weights_are_already_in_the_library_returns_that_model(
    client, app, tmp_path, train_project, fake_trainer
):
    # The FakeTrainer writes the same bytes every run, so the second run's weights are a sha hit.
    handle = app.state.projects.get(train_project["id"])
    dataset = make_dataset(handle)
    base = add_library_model(app, tmp_path, name="yolo11n-coco", origin="starter")
    results = []
    for name in ("first", "second"):
        r = client.post(f"{BASE}/{train_project['id']}/train", json=train_body(dataset.id, base.id, name=name))
        assert r.status_code == 202, r.text
        done = wait_for(client, train_project["id"], r.json()["job"]["id"])
        assert done["state"] == "succeeded", done["error"]
        results.append(done["result"])
    assert results[1]["model_id"] == results[0]["model_id"]
    trained = [m for m in client.get(f"{LIB}/models").json()["items"] if m["origin"] == "trained"]
    assert [m["name"] for m in trained] == ["first"]


def test_training_from_an_unknown_base_model_is_a_404(client, app, train_project):
    dataset = make_dataset(app.state.projects.get(train_project["id"]))
    r = client.post(f"{BASE}/{train_project['id']}/train", json=train_body(dataset.id, "nope"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_training_from_an_unavailable_base_model_is_a_409(client, app, tmp_path, train_project):
    dataset = make_dataset(app.state.projects.get(train_project["id"]))
    base = add_library_model(app, tmp_path)
    service.weights_file(app.state.library, base).unlink()
    r = client.post(f"{BASE}/{train_project['id']}/train", json=train_body(dataset.id, base.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"


def test_training_without_a_library_is_a_503(client, app, train_project):
    dataset = make_dataset(app.state.projects.get(train_project["id"]))
    app.state.library = None
    r = client.post(f"{BASE}/{train_project['id']}/train", json=train_body(dataset.id, "any"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_the_old_project_model_routes_are_gone(client, train_project):
    assert client.get(f"{BASE}/{train_project['id']}/models").status_code == 404
    assert client.post(f"{BASE}/{train_project['id']}/models/train", json={}).status_code == 404


# ----------------------------------------------------------------------- export


def test_export_writes_into_the_models_exports_folder(client, app, tmp_path, fake_trainer):
    m = add_library_model(app, tmp_path)
    r = client.post(f"{LIB}/models/{m.id}/export", json={"format": "onnx", "imgsz": 640})
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == "library_export" and job["project_id"] == "library"
    done = wait_library_job(client, job["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"] == {"format": "onnx", "path": "exports/weights.onnx"}
    got = client.get(f"{LIB}/models/{m.id}").json()
    assert got["exports"] == {"onnx": "exports/weights.onnx"}
    assert (service.model_dir(app.state.library, m) / "exports" / "weights.onnx").is_file()


def test_an_engine_export_keeps_its_intermediate_onnx(client, app, tmp_path, fake_trainer):
    m = add_library_model(app, tmp_path)
    job = client.post(f"{LIB}/models/{m.id}/export", json={"format": "engine"}).json()["job"]
    assert wait_library_job(client, job["id"])["state"] == "succeeded"
    got = client.get(f"{LIB}/models/{m.id}").json()
    assert got["exports"] == {"engine": "exports/weights.engine", "onnx": "exports/weights.onnx"}
    folder = service.model_dir(app.state.library, m)
    assert sorted(p.name for p in folder.iterdir()) == ["exports", "weights.pt"]
    assert client.delete(f"{LIB}/models/{m.id}").status_code == 204
    assert not folder.exists()


# ---------------------------------------------------------------------- starters


@pytest.fixture
def starter_folder(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "starter_weights"
    d.mkdir()
    (d / "yolo11n.pt").write_bytes(b"x" * 2_000_000)
    monkeypatch.setattr(starter, "weights_dir", lambda settings: d)
    stub_checkpoint(monkeypatch, names=["person", "truck"])
    return d


def test_acquiring_a_starter_adds_it_to_the_library(client, starter_folder):
    r = client.post(f"{LIB}/starters/yolo11n/acquire")
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == "library_starter" and job["project_id"] == "library"
    done = wait_library_job(client, job["id"])
    assert done["state"] == "succeeded", done["error"]
    m = client.get(f"{LIB}/models/{done['result']['model_id']}").json()
    assert m["origin"] == "starter" and m["name"] == "yolo11n-coco"
    assert m["class_names"] == ["person", "truck"]
    assert m["class_aliases"] == {"truck": "dump_truck"}  # never filtered by a project
    assert (starter_folder / "yolo11n.pt").is_file()  # the bundled file stays

    again = client.post(f"{LIB}/starters/yolo11n/acquire", json={"name": "mine"}).json()["job"]
    again = wait_library_job(client, again["id"])
    assert again["state"] == "succeeded"
    assert again["result"]["model_id"] == m["id"]  # the same weights are one library model
    assert len(client.get(f"{LIB}/models").json()["items"]) == 1


def test_a_starter_name_can_be_chosen(client, starter_folder):
    job = client.post(f"{LIB}/starters/yolo11n/acquire", json={"name": "coco small"}).json()["job"]
    done = wait_library_job(client, job["id"])
    assert client.get(f"{LIB}/models/{done['result']['model_id']}").json()["name"] == "coco small"


def test_an_unknown_starter_is_a_404(client):
    r = client.post(f"{LIB}/starters/yolo99/acquire")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_a_starter_that_cannot_be_downloaded_fails_the_job(client):
    """The test app disables downloads; the absent bundle makes every starter a download."""
    job = client.post(f"{LIB}/starters/yolo11s/acquire").json()["job"]
    done = wait_library_job(client, job["id"])
    assert done["state"] == "failed"
    assert "disabled in tests" in done["error"]


# --------------------------------------------------------- runs load library models


class Captured:
    def __init__(self):
        self.kwargs: dict = {}

    def __call__(self, kind, **kwargs):
        self.kwargs = {"kind": kind, **kwargs}
        return object()


def _ctx(app, handle):
    return SimpleNamespace(runner=app.state.jobs, project=handle, cancelled=threading.Event())


def test_a_query_run_loads_the_library_weights(app, tmp_path, handle, monkeypatch):
    from app.inference import jobs

    m = add_library_model(app, tmp_path, class_aliases={"truck": "dump_truck"})
    captured = Captured()
    monkeypatch.setattr(jobs, "get_provider", captured)
    run = SimpleNamespace(kind="local_model", model_id=m.id, tiling={"tile_size": 1280})
    jobs._build_provider(_ctx(app, handle), run, ["excavator"])
    assert captured.kwargs["kind"] == "local_model"
    assert captured.kwargs["weights"] == service.weights_file(app.state.library, m)
    assert captured.kwargs["model_row"].id == m.id


def test_a_map_run_loads_the_library_weights(app, tmp_path, handle, monkeypatch):
    from app.maps import jobs_detect

    m = add_library_model(app, tmp_path)
    captured = Captured()
    monkeypatch.setattr(jobs_detect, "get_provider", captured)
    run = SimpleNamespace(kind="local_model", model_id=m.id, tile_size=1280)
    jobs_detect._provider(_ctx(app, handle), run, ["excavator"])
    assert captured.kwargs["weights"] == service.weights_file(app.state.library, m)


def test_the_provider_factory_builds_from_the_given_weights(client, app, tmp_path):
    from app.providers.factory import get_provider

    m = add_library_model(
        app, tmp_path, class_names=["truck", "excavator"], class_aliases={"truck": "dump_truck"}
    )
    weights = service.weights_file(app.state.library, m)
    provider = get_provider(
        "local_model",
        weights=weights,
        keys=None,
        config=None,
        model_row=m,
        project_class_names=["excavator", "dump_truck"],
    )
    assert provider.weights == weights


@pytest.fixture
def detect_project(client, tmp_path) -> dict:
    body = {
        "name": "Site",
        "folder": str(tmp_path / "detect-proj"),
        "classes": [{"name": "excavator", "colour": "#ff0000"}],
        "kind": "detect",
    }
    r = client.post(BASE, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def one_image(app, detect_project, make_jpeg) -> str:
    from app.db.models import Image, Source

    handle = app.state.projects.get(detect_project["id"])
    with handle.session() as s:
        source = Source(folder=str(handle.folder), site="test")
        s.add(source)
        s.flush()
        make_jpeg(handle.folder / "images" / "f0.jpg", 640, 480)
        row = Image(path="images/f0.jpg", width=640, height=480, source_id=source.id)
        s.add(row)
        s.flush()
        return row.id


def test_a_local_run_with_an_unavailable_model_is_refused_before_any_job(
    client, app, tmp_path, detect_project, one_image
):
    m = add_library_model(app, tmp_path)
    service.weights_file(app.state.library, m).unlink()
    body = {"kind": "local_model", "model_id": m.id, "image_ids": [one_image]}
    r = client.post(f"{BASE}/{detect_project['id']}/query-runs", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"
    assert client.get(f"{BASE}/{detect_project['id']}/jobs").json()["items"] == []


def test_a_local_run_without_a_library_is_a_503(client, app, detect_project, one_image):
    app.state.library = None
    body = {"kind": "local_model", "model_id": "any", "image_ids": [one_image]}
    r = client.post(f"{BASE}/{detect_project['id']}/query-runs", json=body)
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_a_local_run_records_the_library_model_name(
    client, app, tmp_path, detect_project, one_image, monkeypatch
):
    monkeypatch.setattr(
        "app.inference.jobs.get_provider", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
    )
    m = add_library_model(app, tmp_path, name="client-x")
    body = {"kind": "local_model", "model_id": m.id, "image_ids": [one_image]}
    r = client.post(f"{BASE}/{detect_project['id']}/query-runs", json=body)
    assert r.status_code == 202, r.text
    assert r.json()["query_run"]["model_name"] == "client-x"
    assert r.json()["query_run"]["model_id"] == m.id


# ------------------------------------------------------------- a real checkpoint


def test_a_real_checkpoint_imports_with_its_coco_classes(client):
    if not YOLO11N.is_file():
        pytest.skip(f"{YOLO11N} not present (run scripts/fetch_starter_weights.ps1)")
    body = {"name": "yolo11n coco", "weights_path": str(YOLO11N), "class_aliases": {"truck": "dump_truck"}}
    r = client.post(f"{LIB}/models/import", json=body)
    assert r.status_code == 202, r.text
    done = wait_library_job(client, r.json()["job"]["id"], timeout=180)
    assert done["state"] == "succeeded", done["error"]
    m = client.get(f"{LIB}/models/{done['result']['model_id']}").json()
    assert m["task"] == "detect"
    assert m["class_names"][:3] == ["person", "bicycle", "car"] and len(m["class_names"]) == 80
