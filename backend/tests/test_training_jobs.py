"""Train and export jobs end to end with the in-process FakeTrainer (no GPU, no ultralytics)."""

import time
from pathlib import Path

import pytest
import yaml
from fakes import FakeTrainer

from app.db.models import Dataset, Model

BASE = "/api/v1/projects"


def models_url(project_id: str) -> str:
    return f"{BASE}/{project_id}/models"


@pytest.fixture
def fake_weights(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr("app.training.registry.read_class_names", lambda path: ["excavator", "dump_truck"])
    p = tmp_path / "base.pt"
    p.write_bytes(b"not a checkpoint")
    return p


@pytest.fixture
def base_model(client, project_id, fake_weights) -> dict:
    body = {"name": "yolo11n", "weights_path": str(fake_weights)}
    return client.post(f"{models_url(project_id)}/import", json=body).json()


def make_dataset(handle, name: str = "v1", materialise: bool = True) -> Dataset:
    """The layout S1's materialise job produces; S3 only reads it, so the tests build it by hand."""
    path = f"datasets/{name}"
    folder = handle.folder / path
    if materialise:
        for split in ("train", "val"):
            (folder / "images" / split).mkdir(parents=True, exist_ok=True)
            (folder / "labels" / split).mkdir(parents=True, exist_ok=True)
        (folder / "data.yaml").write_text(
            yaml.safe_dump(
                {
                    "path": str(folder),
                    "train": "images/train",
                    "val": "images/val",
                    "names": {0: "excavator", 1: "dump_truck"},
                }
            ),
            encoding="utf-8",
        )
    row = Dataset(
        name=name,
        classes=[{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}],
        split_method="by_group",
        split_params={"val_fraction": 0.2, "seed": 1},
        path=path,
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


@pytest.fixture
def dataset(handle) -> Dataset:
    return make_dataset(handle)


@pytest.fixture
def use_fake_trainer(monkeypatch):
    def install(**kwargs) -> FakeTrainer:
        trainer = FakeTrainer(**kwargs)
        monkeypatch.setattr("app.training.jobs.get_trainer", lambda: trainer)
        return trainer

    return install


def wait_for(client, project_id, job_id, timeout=20) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"{BASE}/{project_id}/jobs/{job_id}").json()
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


def wait_for_progress(client, project_id, job_id, timeout=20) -> dict:
    """Block until the job reports its first epoch, so a cancel lands mid-training."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"{BASE}/{project_id}/jobs/{job_id}").json()
        if job["progress"] > 0:
            return job
        assert job["state"] in ("queued", "running"), job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} reported no progress")


def start_train(client, project_id, dataset_id, base_model_id, **over) -> dict:
    body = {
        "name": "ahmadia v1 n",
        "dataset_id": dataset_id,
        "base_model_id": base_model_id,
        "epochs": 3,
        "imgsz": 640,
        "augmentation": "aerial",
        "device": "cpu",
        **over,
    }
    r = client.post(f"{models_url(project_id)}/train", json=body)
    assert r.status_code == 202, r.text
    return r.json()["job"]


def test_train_job_registers_the_model(client, project_id, handle, dataset, base_model, use_fake_trainer):
    use_fake_trainer(map50=0.61)
    job = start_train(client, project_id, dataset.id, base_model["id"])
    assert job["type"] == "train"
    assert job["state"] in ("queued", "running")

    done = wait_for(client, project_id, job["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["progress"] == 1.0
    model_id = done["result"]["model_id"]
    assert done["result"]["metrics"]["map50"] == 0.61

    model = client.get(f"{models_url(project_id)}/{model_id}").json()
    assert model["kind"] == "trained"
    assert model["name"] == "ahmadia v1 n"
    assert model["metrics"]["map50"] == 0.61
    assert model["metrics"]["per_class"][0]["class_name"] == "excavator"
    assert model["dataset_id"] == dataset.id
    assert model["base_weights"] == base_model["weights_path"]
    assert model["run_id"] == job["id"]
    assert model["class_names"] == ["excavator", "dump_truck"]
    assert model["hyperparameters"]["epochs"] == 3
    assert model["hyperparameters"]["augmentation"] == "aerial"
    assert (handle.folder / model["weights_path"]).exists()
    assert model["weights_path"].startswith("models/ahmadia-v1-n-")
    assert model["artifacts"]["results_csv"] == f"runs/{job['id']}/train/results.csv"
    assert (handle.folder / model["artifacts"]["results_csv"]).exists()
    assert (handle.folder / model["artifacts"]["confusion_matrix"]).exists()


def test_train_job_publishes_epoch_progress(client, project_id, dataset, base_model, use_fake_trainer):
    use_fake_trainer()
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = start_train(client, project_id, dataset.id, base_model["id"])
        messages: list[str] = []
        for _ in range(60):
            ev = ws.receive_json()
            if ev["job_id"] != job["id"]:
                continue
            if ev["type"] == "job.progress":
                messages.append(ev["message"])
            if ev["type"] == "job.state" and ev["payload"]["state"] in ("succeeded", "failed"):
                assert ev["payload"]["state"] == "succeeded"
                break
    assert [m for m in messages if m.startswith("epoch")] == [
        "epoch 1/3 mAP50 0.500",
        "epoch 2/3 mAP50 0.500",
        "epoch 3/3 mAP50 0.500",
    ]


def test_cancelling_training_leaves_no_model(
    client, project_id, handle, dataset, base_model, use_fake_trainer
):
    use_fake_trainer(epoch_sleep_s=0.3)
    job = start_train(client, project_id, dataset.id, base_model["id"], epochs=50)
    wait_for_progress(client, project_id, job["id"])  # cancel mid-training, not before it starts
    assert client.post(f"{BASE}/{project_id}/jobs/{job['id']}/cancel").status_code == 200
    done = wait_for(client, project_id, job["id"])
    assert done["state"] == "cancelled"
    assert done["result"] is None
    with handle.session() as s:
        assert [m.kind for m in s.query(Model).all()] == ["imported"]


def test_failing_training_marks_the_job_failed(
    client, project_id, handle, dataset, base_model, use_fake_trainer
):
    use_fake_trainer(fail=True)
    job = start_train(client, project_id, dataset.id, base_model["id"])
    done = wait_for(client, project_id, job["id"])
    assert done["state"] == "failed"
    assert "fake trainer failure" in done["error"]
    with handle.session() as s:
        assert [m.kind for m in s.query(Model).all()] == ["imported"]
    log = client.get(f"{BASE}/{project_id}/jobs/{job['id']}/log").json()
    assert any("Traceback" in line for line in log["lines"])


def test_train_needs_a_materialised_dataset(client, project_id, handle, base_model):
    empty = make_dataset(handle, name="not-yet", materialise=False)
    body = {"name": "x", "dataset_id": empty.id, "base_model_id": base_model["id"]}
    r = client.post(f"{models_url(project_id)}/train", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert "data.yaml" in r.json()["error"]["message"]


def test_train_with_unknown_ids_is_404(client, project_id, dataset, base_model):
    unknown_base = {"name": "x", "dataset_id": dataset.id, "base_model_id": "nope"}
    r = client.post(f"{models_url(project_id)}/train", json=unknown_base)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    unknown_dataset = {"name": "x", "dataset_id": "nope", "base_model_id": base_model["id"]}
    assert client.post(f"{models_url(project_id)}/train", json=unknown_dataset).status_code == 404


def test_train_rejects_zero_epochs(client, project_id, dataset, base_model):
    body = {"name": "x", "dataset_id": dataset.id, "base_model_id": base_model["id"], "epochs": 0}
    assert client.post(f"{models_url(project_id)}/train", json=body).status_code == 422


def test_export_job_records_the_artifact(client, project_id, handle, base_model, use_fake_trainer):
    use_fake_trainer()
    r = client.post(
        f"{models_url(project_id)}/{base_model['id']}/export", json={"format": "onnx", "imgsz": 640}
    )
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == "export"

    done = wait_for(client, project_id, job["id"])
    assert done["state"] == "succeeded", done["error"]
    assert done["result"]["format"] == "onnx"

    model = client.get(f"{models_url(project_id)}/{base_model['id']}").json()
    expected = Path(base_model["weights_path"]).with_suffix(".onnx").as_posix()
    assert model["exports"]["onnx"] == expected == done["result"]["path"]
    assert (handle.folder / expected).exists()


def test_export_of_an_unknown_model_is_404(client, project_id):
    r = client.post(f"{models_url(project_id)}/nope/export", json={"format": "onnx"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_export_rejects_an_unknown_format(client, project_id, base_model):
    r = client.post(f"{models_url(project_id)}/{base_model['id']}/export", json={"format": "coreml"})
    assert r.status_code == 422


def test_train_rejects_a_dataset_whose_yaml_drifted_from_its_class_snapshot(
    client, project_id, handle, base_model
):
    """A stale data.yaml would silently train class 0 as the wrong name (S1 owns materialising)."""
    dataset = make_dataset(handle, name="drifted")
    folder = handle.folder / dataset.path
    data = yaml.safe_load((folder / "data.yaml").read_text(encoding="utf-8"))
    data["names"] = {0: "dump_truck", 1: "excavator"}  # swapped
    (folder / "data.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")

    body = {"name": "x", "dataset_id": dataset.id, "base_model_id": base_model["id"]}
    r = client.post(f"{models_url(project_id)}/train", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    message = r.json()["error"]["message"]
    assert "excavator" in message and "dump_truck" in message


def test_engine_export_also_records_the_intermediate_onnx(
    client, project_id, handle, base_model, use_fake_trainer
):
    """TensorRT goes through ONNX; that file stays next to the weights, so the registry owns it."""
    use_fake_trainer()
    r = client.post(f"{models_url(project_id)}/{base_model['id']}/export", json={"format": "engine"})
    assert r.status_code == 202, r.text
    done = wait_for(client, project_id, r.json()["job"]["id"])
    assert done["state"] == "succeeded", done["error"]

    model = client.get(f"{models_url(project_id)}/{base_model['id']}").json()
    stem = Path(base_model["weights_path"]).with_suffix("")
    assert model["exports"]["engine"] == f"{stem.as_posix()}.engine"
    assert model["exports"]["onnx"] == f"{stem.as_posix()}.onnx"
    files = [handle.folder / model["exports"][k] for k in ("engine", "onnx")]
    assert all(f.exists() for f in files)

    assert client.delete(f"{models_url(project_id)}/{base_model['id']}").status_code == 204
    assert not any(f.exists() for f in files)  # no orphan next to the deleted weights
