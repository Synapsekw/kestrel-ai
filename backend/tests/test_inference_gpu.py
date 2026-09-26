"""Real GPU inference with imported YOLO11m weights (spec section 12).

Marked `gpu`, so the default suite skips it: `pytest -m gpu -q tests/test_inference_gpu.py`.
Frames are read from the raw folder and never modified.
"""

import logging
import shutil
import time
from pathlib import Path

import pytest
from local_paths import FRAMES_DIR, MODELS_DIR

from app.library import service as library
from app.providers.base import TilingSpec
from app.providers.local_yolo import LocalYoloProvider, build_class_map

pytestmark = pytest.mark.gpu

FRAMES = FRAMES_DIR
YOLO11M = MODELS_DIR / "yolo11m.pt"
TILED_BUDGET_S = 60
FULL_FRAME_BUDGET_S = 30


@pytest.fixture(autouse=True)
def needs_cuda():
    import torch

    if not torch.cuda.is_available():
        pytest.skip("no CUDA device")


@pytest.fixture
def frame() -> Path:
    if not FRAMES.is_dir():
        pytest.skip(f"{FRAMES} not present")
    return sorted(FRAMES.glob("*.jpg"))[0]


@pytest.fixture
def imported_row(app, handle, project):
    if not YOLO11M.is_file():
        pytest.skip(f"{YOLO11M} not present")
    task, names = library.read_checkpoint(YOLO11M)
    return library.add_model(
        app.state.library,
        source_weights=YOLO11M,
        name="yolo11m",
        origin="imported",
        task=task,
        class_names=names,
        class_aliases={"truck": "dump_truck"},
    )


@pytest.fixture
def imported(app, handle, project, imported_row):
    classes = [c["name"] for c in project["classes"]]
    class_map = build_class_map(imported_row.class_names, classes, imported_row.class_aliases)
    return library.weights_file(app.state.library, imported_row), class_map, classes


def test_tiled_inference_on_a_real_frame_stays_inside_the_image(imported, frame):
    from PIL import Image as PILImage

    weights, class_map, classes = imported
    assert class_map == {"truck": "dump_truck"}  # COCO weights only claim the aliased class
    with PILImage.open(frame) as im:
        width, height = im.size
    provider = LocalYoloProvider(weights, class_map)

    started = time.monotonic()
    dets = provider.detect(frame, "", classes, TilingSpec(), conf=0.1, log=logging.getLogger("gpu"))
    elapsed = time.monotonic() - started

    assert isinstance(dets, list)  # the COCO model rarely fires on nadir frames: empty is a pass
    assert elapsed < TILED_BUDGET_S, f"tiled inference took {elapsed:.1f} s"
    for d in dets:
        assert d.label in classes
        assert 0 <= d.x and 0 <= d.y and d.x + d.w <= width and d.y + d.h <= height


def test_untiled_inference_at_2560_is_quick(imported, frame):
    weights, class_map, classes = imported
    provider = LocalYoloProvider(weights, class_map, imgsz=2560)
    started = time.monotonic()
    dets = provider.detect(
        frame, "", classes, TilingSpec(enabled=False), conf=0.25, log=logging.getLogger("gpu")
    )
    elapsed = time.monotonic() - started
    assert isinstance(dets, list)
    assert elapsed < FULL_FRAME_BUDGET_S, f"full-frame inference took {elapsed:.1f} s"


def test_preannotate_runs_yolo11m_on_a_real_frame_through_the_api(
    client, project_id, handle, project_dir, imported_row, frame
):
    from app.db.models import Image, Source

    with handle.session() as s:
        source = Source(folder=str(project_dir), site="gpu")
        s.add(source)
        s.flush()
        shutil.copy2(frame, project_dir / "images" / frame.name)
        row = Image(path=f"images/{frame.name}", width=4000, height=2667, source_id=source.id)
        s.add(row)
        s.flush()
        image_id = row.id
    body = {"preannotation_model_id": imported_row.id}
    assert client.patch(f"/api/v1/projects/{project_id}", json=body).status_code == 200

    started = time.monotonic()
    r = client.post(
        f"/api/v1/projects/{project_id}/images/{image_id}/preannotate", json={"imgsz": 2560, "conf": 0.25}
    )
    elapsed = time.monotonic() - started

    assert r.status_code == 200, r.text
    result = r.json()
    assert result["skipped"] is False
    assert result["model_id"] == imported_row.id
    assert isinstance(result["items"], list)
    assert elapsed < FULL_FRAME_BUDGET_S, f"pre-annotation took {elapsed:.1f} s"
    for item in result["items"]:
        assert item["provenance"]["kind"] == "local_model"
        assert item["review_state"] == "unreviewed"
