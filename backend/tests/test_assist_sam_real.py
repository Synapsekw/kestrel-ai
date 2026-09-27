"""Real SAM 2.1 tiny through the service (spec §17 `-m gpu`; Deviations 5).

Marked `gpu`, so the default suite skips it: `pytest -m gpu -q tests/test_assist_sam_real.py`.
Needs the real weights (KESTREL_SAM_WEIGHTS, else <MODELS_DIR>/sam2.1_t.pt); frames are only read.
"""

import os
from pathlib import Path

import cv2
import numpy as np
import pytest
from local_paths import FRAMES_DIR, MODELS_DIR
from PIL import Image as PILImage

from app.assist.geometry import quantise_crop
from app.assist.sam import SegmentBackend
from app.assist.service import SegmentService
from app.jobs.gpu import gpu_lock

pytestmark = pytest.mark.gpu

WEIGHTS = Path(os.environ.get("KESTREL_SAM_WEIGHTS", MODELS_DIR / "sam2.1_t.pt"))


@pytest.fixture(autouse=True)
def needs_weights():
    if not WEIGHTS.is_file():
        pytest.skip(f"{WEIGHTS} not present")


def _cuda() -> bool:
    import torch

    return torch.cuda.is_available()


def _iou(polygon, truth: np.ndarray) -> float:
    drawn = np.zeros(truth.shape, np.uint8)
    cv2.fillPoly(drawn, [np.round(np.array(polygon)).astype(np.int32)], 1)
    inter = np.logical_and(drawn > 0, truth).sum()
    return inter / np.logical_or(drawn > 0, truth).sum()


def _disc_frame(tmp_path) -> tuple[Path, np.ndarray]:
    img = np.full((1500, 2000, 3), 40, np.uint8)
    cv2.circle(img, (1000, 800), 90, (220, 220, 220), -1)
    truth = np.zeros((1500, 2000), np.uint8)
    cv2.circle(truth, (1000, 800), 90, 1, -1)
    path = tmp_path / "disc.png"
    PILImage.fromarray(img).save(path)
    return path, truth.astype(bool)


def _spall_frame(tmp_path) -> tuple[Path, np.ndarray, tuple[float, float]]:
    """A real aerial frame with a dark, textured, irregular blob of known outline pasted in."""
    frames = sorted(FRAMES_DIR.glob("*.jpg"))
    if not frames:
        pytest.skip(f"no frames in {FRAMES_DIR}")
    with PILImage.open(frames[0]) as im:
        img = np.asarray(im.convert("RGB")).copy()
    h, w = img.shape[:2]
    cx, cy = w * 0.5, h * 0.5
    rng = np.random.default_rng(7)
    angles = np.linspace(0, 2 * np.pi, 24, endpoint=False)
    radii = 120 * (1 + 0.25 * rng.standard_normal(24)).clip(0.6, 1.4)
    outline = np.stack([cx + radii * np.cos(angles), cy + 0.7 * radii * np.sin(angles)], 1).astype(np.int32)
    truth = np.zeros((h, w), np.uint8)
    cv2.fillPoly(truth, [outline], 1)
    texture = rng.integers(25, 60, size=(h, w, 1), dtype=np.uint8).repeat(3, axis=2)
    img[truth > 0] = texture[truth > 0]
    path = tmp_path / "spall.png"
    PILImage.fromarray(img).save(path)
    return path, truth.astype(bool), (cx, cy)


def test_the_real_backend_satisfies_c0s_protocol():
    from app.assist.ultralytics_backend import UltralyticsSam2Backend

    assert isinstance(UltralyticsSam2Backend(WEIGHTS), SegmentBackend)


@pytest.mark.parametrize("device", ["cpu", "cuda"])
def test_real_sam_outlines_a_disc(tmp_path, device):
    if device == "cuda" and not _cuda():
        pytest.skip("no CUDA")
    path, truth = _disc_frame(tmp_path)
    svc = SegmentService(cuda_available=lambda: device == "cuda")
    crop = quantise_crop(700, 500, 600, 400, 2000, 1500)  # non-square: exercises the letterbox mapping
    out = svc.segment(("p", "i"), path, crop, WEIGHTS, [(1000.0, 800.0)], [1])
    svc.unload()
    assert out.device == device and out.polygon is not None and len(out.polygon) <= 256
    assert _iou(out.polygon, truth) >= 0.9


def test_real_sam_outlines_a_spall_on_a_real_frame(tmp_path):
    path, truth, (cx, cy) = _spall_frame(tmp_path)
    h, w = truth.shape
    svc = SegmentService()
    crop = quantise_crop(cx - 400, cy - 300, 800, 600, w, h)
    out = svc.segment(("p", "i"), path, crop, WEIGHTS, [(cx, cy)], [1])
    svc.unload()
    assert out.polygon is not None
    assert _iou(out.polygon, truth) >= 0.8


def test_real_sam_runs_on_the_cpu_while_the_gpu_is_held(tmp_path):
    if not _cuda():
        pytest.skip("no CUDA")
    path, truth = _disc_frame(tmp_path)
    svc = SegmentService()
    crop = quantise_crop(700, 500, 600, 600, 2000, 1500)
    first = svc.prepare(("p", "i"), path, crop, WEIGHTS)
    assert gpu_lock.acquire(timeout=5)
    try:
        out = svc.segment(("p", "i"), path, crop, WEIGHTS, [(1000.0, 800.0)], [1])
    finally:
        gpu_lock.release()
    svc.unload()
    assert (first.device, out.device) == ("cuda", "cpu")
    assert out.encode_ms == 0  # the CUDA embedding was reused on the CPU
    assert _iou(out.polygon, truth) >= 0.9
