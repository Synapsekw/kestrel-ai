"""One real YOLO11n training run on the GPU, end to end through the API (spec section 12).

Marked `gpu`, so the default suite skips it: `pytest -m gpu -q tests/test_training_gpu.py`.
It builds a tiny dataset from real aerial frames (copied, never modified) and trains one epoch.
"""

import importlib.util
import json
import shutil
import time

import pytest
import yaml
from local_paths import FRAMES_DIR, MODELS_DIR
from PIL import Image as PILImage

from app.db.models import Dataset

pytestmark = pytest.mark.gpu

FRAMES = FRAMES_DIR
YOLO11N = MODELS_DIR / "yolo11n.pt"
CLASSES = ["excavator", "dump_truck"]
BASE = "/api/v1/projects"
TRAIN_TIMEOUT_S = 600
EXPORT_TIMEOUT_S = 600


@pytest.fixture(autouse=True)
def needs_cuda():
    import torch

    if not torch.cuda.is_available():
        pytest.skip("no CUDA device")


def wait_for(client, project_id, job_id, timeout) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"{BASE}/{project_id}/jobs/{job_id}").json()
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(1.0)
    raise AssertionError(f"job {job_id} still {job['state']} after {timeout}s")


def build_dataset(handle, frames: int = 8, side: int = 640) -> Dataset:
    """8 real frames downscaled to 640 px, one synthetic box each, in the layout S1 materialises."""
    folder = handle.folder / "datasets" / "gpu"
    sources = sorted(FRAMES.glob("*.jpg"))[:frames]
    assert len(sources) == frames, f"expected {frames} frames under {FRAMES}"
    for split in ("train", "val"):
        (folder / "images" / split).mkdir(parents=True, exist_ok=True)
        (folder / "labels" / split).mkdir(parents=True, exist_ok=True)
        for i, src in enumerate(sources):
            with PILImage.open(src) as im:
                im = im.convert("RGB")
                im.thumbnail((side, side))
                im.save(folder / "images" / split / f"{src.stem}.jpg", quality=90)
            label = folder / "labels" / split / f"{src.stem}.txt"
            label.write_text(f"{i % len(CLASSES)} 0.5 0.5 0.25 0.25\n", encoding="utf-8")
    (folder / "data.yaml").write_text(
        yaml.safe_dump(
            {
                "path": str(folder),
                "train": "images/train",
                "val": "images/val",
                "names": dict(enumerate(CLASSES)),
            }
        ),
        encoding="utf-8",
    )
    row = Dataset(
        name="gpu",
        classes=[{"id": f"c{i}", "name": n} for i, n in enumerate(CLASSES)],
        split_method="random",
        split_params={"val_fraction": 0.5, "seed": 1},
        path="datasets/gpu",
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def test_train_one_epoch_on_the_gpu_and_export(client, project_id, handle, tmp_path):
    dataset = build_dataset(handle)
    weights = tmp_path / "yolo11n.pt"
    shutil.copy2(YOLO11N, weights)  # the shared models folder is a read-only input
    base = client.post(
        f"{BASE}/{project_id}/models/import", json={"name": "yolo11n", "weights_path": str(weights)}
    ).json()
    assert len(base["class_names"]) == 80

    body = {
        "name": "gpu smoke",
        "dataset_id": dataset.id,
        "base_model_id": base["id"],
        "epochs": 1,
        "imgsz": 320,
        "batch": 4,
        "patience": 1,
        "augmentation": "aerial",
        "device": "0",
    }
    r = client.post(f"{BASE}/{project_id}/models/train", json=body)
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    done = wait_for(client, project_id, job["id"], TRAIN_TIMEOUT_S)
    assert done["state"] == "succeeded", (done["error"], done["message"])

    events = [
        json.loads(line)
        for line in (handle.runs_dir / job["id"] / "progress.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [e["kind"] for e in events][0] == "start"
    epochs = [e for e in events if e["kind"] == "epoch"]
    assert len(epochs) == 1
    assert epochs[0]["epoch"] == 1 and epochs[0]["epochs"] == 1
    assert epochs[0]["loss"] and epochs[0]["elapsed_s"] > 0

    model = client.get(f"{BASE}/{project_id}/models/{done['result']['model_id']}").json()
    assert model["kind"] == "trained"
    metrics = model["metrics"]
    for key in ("map50", "map50_95", "precision", "recall"):
        assert isinstance(metrics[key], float)
    assert [c["class_name"] for c in metrics["per_class"]]
    assert set(c["class_name"] for c in metrics["per_class"]) <= set(CLASSES)
    assert (handle.folder / model["artifacts"]["results_csv"]).exists()
    assert (handle.folder / model["artifacts"]["confusion_matrix"]).exists()
    assert (handle.folder / model["weights_path"]).exists()

    r = client.post(f"{BASE}/{project_id}/models/{model['id']}/export", json={"format": "onnx", "imgsz": 320})
    assert r.status_code == 202, r.text
    export_job = wait_for(client, project_id, r.json()["job"]["id"], EXPORT_TIMEOUT_S)
    if importlib.util.find_spec("onnx") is None:
        # The reference environment has no onnx and the worker forbids auto-installing one, so the
        # job has to fail with a readable message instead of pip-installing into the user's venv.
        assert export_job["state"] == "failed"
        assert "onnx" in export_job["error"].lower()
        assert importlib.util.find_spec("onnx") is None, "the export job installed a package"
        return
    assert export_job["state"] == "succeeded", export_job["error"]
    exported = handle.folder / export_job["result"]["path"]
    assert exported.exists() and exported.suffix == ".onnx"
    assert client.get(f"{BASE}/{project_id}/models/{model['id']}").json()["exports"]["onnx"]
