"""SegmentService (spec §10 Device, Memory, Flow; §17 SAM tests; rulings BS6, BS7, BS11, BS12)."""

import math
import time

import cv2
import numpy as np
import pytest
from assist_fakes import FakeDiscBackend, FakeFactory
from PIL import Image as PILImage

from app.assist.errors import AssistUnavailable
from app.assist.geometry import quantise_crop
from app.assist.sam import SegmentBackend
from app.assist.service import SegmentService
from app.jobs.gpu import gpu_lock

KEY = ("project-1", "image-1")


@pytest.fixture
def frame(tmp_path):
    path = tmp_path / "frame.jpg"
    PILImage.fromarray(np.full((1500, 2000, 3), 90, np.uint8)).save(path, "JPEG")
    return path


@pytest.fixture
def weights(tmp_path):
    p = tmp_path / "sam2.1_t.pt"
    p.write_bytes(b"w")
    return p


def _service(factory, cuda=False, idle=600.0):
    return SegmentService(backend_factory=factory, cuda_available=lambda: cuda, idle_unload_s=idle)


def test_the_fake_satisfies_c0s_protocol():
    assert isinstance(FakeDiscBackend(), SegmentBackend)


def test_prepare_encodes_once_and_a_pan_inside_the_cell_is_cached(frame, weights):
    factory = FakeFactory()
    svc = _service(factory)
    first = svc.prepare(KEY, frame, quantise_crop(70, 500, 600, 600, 2000, 1500), weights)
    again = svc.prepare(KEY, frame, quantise_crop(100, 500, 600, 600, 2000, 1500), weights)
    assert (first.cached, again.cached) == (False, True)
    assert again.encode_ms == 0 and first.device == "cpu"
    assert factory.made[0].encodes == 1


def test_the_embedding_cache_holds_two(frame, weights):
    factory = FakeFactory()
    svc = _service(factory)
    a, b, c = (quantise_crop(x, 0, 600, 600, 2000, 1500) for x in (0, 700, 1400))
    for crop in (a, b, c, a):
        svc.prepare(KEY, frame, crop, weights)
    assert factory.made[0].encodes == 4  # a was evicted by c
    assert svc.prepare(KEY, frame, c, weights).cached  # c and a are the two resident


def test_a_segment_maps_the_disc_back_to_image_px(frame, weights):
    factory = FakeFactory(radius=60)
    svc = _service(factory)
    crop = quantise_crop(700, 500, 600, 600, 2000, 1500)  # Crop(640, 448, 704, 704)
    out = svc.segment(KEY, frame, crop, weights, [(1000.0, 800.0)], [1])
    assert out.polygon is not None and 3 <= len(out.polygon) <= 256
    assert out.score == pytest.approx(0.9)
    poly = np.array(out.polygon, np.float32)
    moments = cv2.moments(poly)
    cx, cy = moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]
    assert abs(cx - 1000) < 1 and abs(cy - 800) < 1
    r_img = 60 / crop.scale
    assert abs(cv2.contourArea(poly)) == pytest.approx(math.pi * r_img**2, rel=0.06)
    assert all(crop.contains(x, y) for x, y in out.polygon)
    # F10: a real guarantee, not the always-true `>= 0` check — this crop's embedding was not
    # cached, so the service really ran one encode and one decode on the CPU.
    assert isinstance(out.encode_ms, int) and isinstance(out.decode_ms, int)
    assert factory.made[0].calls == [("encode", "cpu"), ("decode", "cpu")]


def test_every_click_sends_all_points_in_model_px(frame, weights):
    factory = FakeFactory()
    svc = _service(factory)
    crop = quantise_crop(700, 500, 600, 600, 2000, 1500)
    svc.segment(KEY, frame, crop, weights, [(1000.0, 800.0), (1100.0, 850.0)], [1, 0])
    points, labels = factory.made[0].decoded[-1]
    assert points[1] == pytest.approx(((1100 - 640) * crop.scale, (850 - 448) * crop.scale))
    assert labels == [1, 0]


def test_an_empty_mask_gives_no_polygon(frame, weights):
    svc = _service(FakeFactory(radius=0))
    out = svc.segment(KEY, frame, quantise_crop(0, 0, 600, 600, 2000, 1500), weights, [(100.0, 100.0)], [1])
    assert out.polygon is None and out.score == 0.0


def test_a_free_gpu_runs_on_cuda(frame, weights):
    factory = FakeFactory()
    out = _service(factory, cuda=True).prepare(KEY, frame, quantise_crop(0, 0, 600, 600, 2000, 1500), weights)
    assert out.device == "cuda" and factory.made[0].calls == [("encode", "cuda")]
    assert not gpu_lock.locked()  # held only for the call


def test_a_held_gpu_lock_runs_on_the_cpu(frame, weights):
    factory = FakeFactory()
    svc = _service(factory, cuda=True)
    crop = quantise_crop(0, 0, 600, 600, 2000, 1500)
    svc.prepare(KEY, frame, crop, weights)  # on cuda
    assert gpu_lock.acquire(timeout=1)  # training holds the card
    try:
        started = time.monotonic()
        out = svc.segment(KEY, frame, crop, weights, [(100.0, 100.0)], [1])
        assert time.monotonic() - started < 2
    finally:
        gpu_lock.release()
    assert out.device == "cpu" and out.encode_ms == 0  # the cached embedding survived the switch
    assert factory.made[0].calls == [("encode", "cuda"), ("decode", "cpu")]
    assert len(factory.made) == 1


def test_a_cuda_failure_falls_back_to_the_cpu(frame, weights):
    factory = FakeFactory(fail_on={"cuda"})
    svc = _service(factory, cuda=True)
    out = svc.prepare(KEY, frame, quantise_crop(0, 0, 600, 600, 2000, 1500), weights)
    assert out.device == "cpu" and svc.unavailable_reason is None


def test_a_cpu_failure_marks_sam_unavailable_until_a_call_succeeds(frame, weights):
    factory = FakeFactory(fail_on={"cpu"})
    svc = _service(factory)
    crop = quantise_crop(0, 0, 600, 600, 2000, 1500)
    with pytest.raises(AssistUnavailable):
        svc.prepare(KEY, frame, crop, weights)
    assert "cannot load SAM on cpu" in svc.unavailable_reason
    factory.fail_on.clear()
    svc.prepare(KEY, frame, crop, weights)
    assert svc.unavailable_reason is None


def test_a_factory_that_cannot_import_marks_sam_unavailable(frame, weights):
    svc = _service(FakeFactory(broken=True))
    with pytest.raises(AssistUnavailable):
        svc.prepare(KEY, frame, quantise_crop(0, 0, 600, 600, 2000, 1500), weights)
    assert "ultralytics.models.sam" in svc.unavailable_reason


def test_the_backend_and_embeddings_unload_when_idle(frame, weights):
    factory = FakeFactory()
    svc = _service(factory, idle=0.05)
    crop = quantise_crop(0, 0, 600, 600, 2000, 1500)
    svc.prepare(KEY, frame, crop, weights)
    deadline = time.monotonic() + 3
    while not factory.made[0].closed and time.monotonic() < deadline:
        time.sleep(0.02)
    assert factory.made[0].closed
    assert not svc.prepare(KEY, frame, crop, weights).cached
    assert len(factory.made) == 2


def test_new_weights_make_a_new_backend(frame, weights, tmp_path):
    factory = FakeFactory()
    svc = _service(factory)
    crop = quantise_crop(0, 0, 600, 600, 2000, 1500)
    svc.prepare(KEY, frame, crop, weights)
    other = tmp_path / "other.pt"
    other.write_bytes(b"o")
    svc.prepare(KEY, frame, crop, other)
    assert len(factory.made) == 2 and factory.made[0].closed


def test_an_unreadable_frame_gives_a_404_not_a_500(tmp_path, weights):
    bad = tmp_path / "not-an-image.jpg"
    bad.write_bytes(b"not actually a jpeg")
    svc = _service(FakeFactory())
    with pytest.raises(Exception) as excinfo:
        svc.prepare(KEY, bad, quantise_crop(0, 0, 600, 600, 2000, 1500), weights)
    err = excinfo.value
    assert getattr(err, "code", None) == "not_found"
    assert getattr(err, "status", None) == 404
