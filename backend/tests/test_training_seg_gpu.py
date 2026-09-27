"""One real YOLO11n-seg epoch on the GPU through the API: a 6-image polygon dataset becomes a
`segment` library model with mask metrics (image spec §17 `-m gpu`; plan I-BT Task 8).

Marked `gpu`, so the default suite skips it: `pytest -m gpu -q tests/test_training_seg_gpu.py`.
Needs `yolo11n-seg.pt` in KESTREL_MODELS_DIR (default E:/Dev/Yolo/models); skips without it.
"""

import shutil

import pytest
from catalogue_fake import catalogue  # noqa: F401 - fixture
from library_datasets_helpers import LIB, add_box, add_source, build_dataset, create_body, make_project
from library_helpers import wait_library_job
from local_paths import FRAMES_DIR, MODELS_DIR
from PIL import Image as PILImage

from app.db.models import Image

pytestmark = pytest.mark.gpu

SEG_WEIGHTS = MODELS_DIR / "yolo11n-seg.pt"
TRAIN_TIMEOUT_S = 900
SIDE = 640


@pytest.fixture(autouse=True)
def needs_cuda_and_weights():
    import torch

    if not torch.cuda.is_available():
        pytest.skip("no CUDA device")
    if not SEG_WEIGHTS.is_file():
        pytest.skip(f"{SEG_WEIGHTS} missing: download yolo11n-seg.pt from the Ultralytics v8.4.0 assets")


def polygon_project(app, tmp_path, catalogue, frames: int = 6):  # noqa: F811
    spall = catalogue.add("Spalling")
    handle = make_project(app, tmp_path / "seg-project", "Seg")
    src = add_source(handle)
    sources = sorted(FRAMES_DIR.glob("*.jpg"))[:frames]
    assert len(sources) == frames, f"expected {frames} frames under {FRAMES_DIR}"
    for i, frame in enumerate(sources):
        rel = f"images/site/{frame.stem}.jpg"
        (handle.folder / rel).parent.mkdir(parents=True, exist_ok=True)
        with PILImage.open(frame) as im:  # the original is never modified
            im = im.convert("RGB")
            im.thumbnail((SIDE, SIDE))
            w, h = im.size
            im.save(handle.folder / rel, quality=90)
        with handle.session() as s:
            row = Image(path=rel, width=w, height=h, source_id=src, group_key=f"g{i}")
            s.add(row)
            s.flush()
            image_id = row.id
        diamond = [[w * 0.5, h * 0.3], [w * 0.7, h * 0.5], [w * 0.5, h * 0.7], [w * 0.3, h * 0.5]]
        add_box(
            handle,
            image_id,
            spall.id,
            shape="polygon",
            points=diamond,
            x=w * 0.3,
            y=h * 0.3,
            w=w * 0.4,
            h=h * 0.4,
            area_px=0.5 * (w * 0.4) * (h * 0.4),
        )
    return handle, spall


def test_one_seg_epoch_registers_a_segment_model(client, app, tmp_path, catalogue):  # noqa: F811
    handle, spall = polygon_project(app, tmp_path, catalogue)
    body = create_body(
        "spalls", [handle.id], [spall.id], task="segment", split_method="random", val_fraction=0.34
    )
    dataset = build_dataset(client, body)
    assert dataset["task"] == "segment" and dataset["counts"]["images"] == 6

    weights = tmp_path / "yolo11n-seg.pt"
    shutil.copy2(SEG_WEIGHTS, weights)  # the shared models folder is a read-only input
    r = client.post(f"{LIB}/models/import", json={"name": "yolo11n-seg", "weights_path": str(weights)})
    assert r.status_code == 202, r.text
    imported = wait_library_job(client, r.json()["job"]["id"], TRAIN_TIMEOUT_S)
    assert imported["state"] == "succeeded", imported["error"]
    base_id = imported["result"]["model_id"]
    assert client.get(f"{LIB}/models/{base_id}").json()["task"] == "segment"

    run = {
        "name": "seg smoke",
        "dataset_id": dataset["id"],
        "base_model_id": base_id,
        "epochs": 1,
        "imgsz": 320,
        "batch": 2,
        "patience": 1,
        "device": "0",
    }
    r = client.post(f"{LIB}/training-runs", json=run)
    assert r.status_code == 202, r.text
    done = wait_library_job(client, r.json()["job"]["id"], TRAIN_TIMEOUT_S)
    assert done["state"] == "succeeded", (done["error"], done["message"])

    model = client.get(f"{LIB}/models/{done['result']['model_id']}").json()
    assert model["task"] == "segment" and model["origin"] == "trained"
    metrics = model["metrics"]
    assert isinstance(metrics["map50"], float)
    assert isinstance(metrics["mask_map50"], float) and isinstance(metrics["mask_map50_95"], float)
