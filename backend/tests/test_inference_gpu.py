"""Real GPU inference with imported YOLO11m weights (spec section 12).

Marked `gpu`, so the default suite skips it: `pytest -m gpu -q tests/test_inference_gpu.py`.
Frames are read from the raw folder and never modified.
"""

import logging
import time
from pathlib import Path

import pytest

from app.providers.base import TilingSpec
from app.providers.local_yolo import LocalYoloProvider, build_class_map
from app.training import registry

pytestmark = pytest.mark.gpu

FRAMES = Path("E:/Dev/Yolo/data/raw/ahmadia")
YOLO11M = Path("E:/Dev/Yolo/models/yolo11m.pt")
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
def imported(handle, project):
    if not YOLO11M.is_file():
        pytest.skip(f"{YOLO11M} not present")
    row = registry.import_model(handle, "yolo11m", str(YOLO11M), {"truck": "dump_truck"})
    classes = [c["name"] for c in project["classes"]]
    class_map = build_class_map(row.class_names, classes, row.class_aliases)
    return handle.folder / row.weights_path, class_map, classes


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
