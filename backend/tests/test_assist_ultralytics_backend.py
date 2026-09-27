"""The real backend's CUDA-failure handling (ruling BS7, controller ruling F3), without the weights.

A fake predictor stands in for `SAM2Predictor`, so this runs in the default suite; the real model is
exercised by `tests/test_assist_sam_real.py` (`-m gpu`).
"""

from pathlib import Path

import numpy as np
import pytest
import torch

from app.assist import ultralytics_backend
from app.assist.errors import AssistUnavailable
from app.assist.geometry import quantise_crop
from app.assist.service import SegmentService
from app.assist.ultralytics_backend import UltralyticsSam2Backend

WEIGHTS = Path("sam2.1_t.pt")


@pytest.fixture(autouse=True)
def keep_torch_threads():
    # The CPU path sets torch's process-wide thread count; restore it for the rest of the suite.
    before = torch.get_num_threads()
    yield
    torch.set_num_threads(before)


class FakePredictor:
    """Answers like SAM2Predictor; `fail` maps (device, step) to the exception that step raises."""

    def __init__(self, device: str, fail: dict):
        self.device = torch.device("cpu")
        self._where, self._fail = device, fail
        self.features = None

    def _maybe_fail(self, step: str):
        error = self._fail.get((self._where, step))
        if error is not None:
            raise error

    def set_image(self, bgr):
        self._maybe_fail("encode")
        self.features = {"image_embed": torch.zeros(1, 4, 8, 8)}

    def reset_image(self):
        self.features = None

    def inference_features(self, features, src_shape, points=None, labels=None, multimask_output=False):
        self._maybe_fail("decode")
        h, w = src_shape
        masks = torch.zeros(3, h, w, dtype=torch.bool)
        masks[1, 10:20, 10:20] = True
        boxes = torch.tensor([[0, 0, 1, 1, 0.2, 0], [10, 10, 20, 20, 0.9, 0], [0, 0, 1, 1, 0.1, 0]])
        return masks, boxes


def _backend(fail: dict, loads: list | None = None) -> UltralyticsSam2Backend:
    def factory(weights, device):
        if loads is not None:
            loads.append(device)
        error = fail.get((device, "load"))
        if error is not None:
            raise error
        return FakePredictor(device, fail)

    return UltralyticsSam2Backend(WEIGHTS, predictor_factory=factory)


RGB = np.zeros((64, 96, 3), np.uint8)
OOM = torch.cuda.OutOfMemoryError("CUDA out of memory. Tried to allocate 2.00 GiB")
CUDA_RUNTIME = RuntimeError("CUDA error: an illegal memory access was encountered")


def test_the_fake_backend_decodes_the_best_scoring_mask():
    backend = _backend({})
    mask, score = backend.decode(backend.encode(RGB, "cpu"), [(15.0, 15.0)], [1], "cpu")
    assert mask.shape == (64, 96) and mask.sum() == 100 and score == pytest.approx(0.9)


def test_the_cpu_thread_cap_survives_ultralytics_resetting_it_on_load(monkeypatch):
    # SAM2Predictor.setup_model -> select_device("cpu") sets torch to min(8, cores - 1) threads.
    monkeypatch.setattr(ultralytics_backend.os, "cpu_count", lambda: 8)

    def factory(weights, device):
        torch.set_num_threads(7)
        return FakePredictor(device, {})

    UltralyticsSam2Backend(WEIGHTS, predictor_factory=factory).encode(RGB, "cpu")
    assert torch.get_num_threads() == 4


@pytest.mark.parametrize("step", ["load", "encode", "decode"])
@pytest.mark.parametrize("error", [OOM, CUDA_RUNTIME], ids=["oom", "runtime"])
def test_a_cuda_failure_becomes_assist_unavailable_and_drops_the_gpu_predictor(step, error):
    loads: list[str] = []
    backend = _backend({("cuda", step): error}, loads)
    embedding = backend.encode(RGB, "cpu") if step == "decode" else None
    with pytest.raises(AssistUnavailable, match="cuda"):
        if step == "decode":
            backend.decode(embedding, [(15.0, 15.0)], [1], "cuda")
        else:
            backend.encode(RGB, "cuda")
    assert backend._predictor is None
    # The next call loads a fresh predictor rather than reusing the failed one.
    backend.encode(RGB, "cpu")
    assert loads[-1] == "cpu"


def test_a_non_cuda_error_on_the_gpu_is_not_masked():
    backend = _backend({("cuda", "encode"): ValueError("bad input")})
    with pytest.raises(ValueError, match="bad input"):
        backend.encode(RGB, "cuda")


def test_cpu_errors_keep_their_handling():
    # A CPU load failure is AssistUnavailable (it marks SAM unavailable); a CPU runtime error is not
    # rewritten, even when its message mentions CUDA.
    with pytest.raises(AssistUnavailable, match="could not load on cpu"):
        _backend({("cpu", "load"): RuntimeError("broken weights")}).encode(RGB, "cpu")
    with pytest.raises(RuntimeError, match="CUDA error"):
        _backend({("cpu", "encode"): CUDA_RUNTIME}).encode(RGB, "cpu")


def test_the_service_falls_back_to_the_cpu_when_cuda_runs_out_of_memory(tmp_path):
    from PIL import Image as PILImage

    frame = tmp_path / "f.png"
    PILImage.fromarray(np.full((600, 800, 3), 40, np.uint8)).save(frame)
    loads: list[str] = []
    svc = SegmentService(
        backend_factory=lambda w: _backend({("cuda", "encode"): OOM}, loads), cuda_available=lambda: True
    )
    crop = quantise_crop(0, 0, 800, 600, 800, 600)
    try:
        out = svc.prepare(("p", "i"), frame, crop, WEIGHTS)
    finally:
        svc.unload()
    assert out.device == "cpu" and loads == ["cuda", "cpu"]
    assert svc.unavailable_reason is None
