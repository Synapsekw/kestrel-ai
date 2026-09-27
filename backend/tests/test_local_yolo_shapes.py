"""Oriented boxes, masks and the CPU path of the local YOLO provider (image inspection spec §11.2,
§11.3, decision I-D13). An OBB model used to return nothing: `_from_result` read `result.boxes` only."""

import logging
import math
import time
from pathlib import Path

import pytest
from PIL import Image as PILImage

from app.jobs.gpu import gpu_lock
from app.providers.base import Tile, TilingSpec
from app.providers.local_yolo import LocalYoloProvider

LOG = logging.getLogger("t")
TILE = Tile(index=1, x=720, y=0, w=1280, h=1280)
NAMES = {0: "crack", 1: "person"}


class Obb:
    """`result.obb` as Ultralytics fills it: xywhr (radians), cls and conf, one row per box."""

    def __init__(self, rows):
        self.xywhr = [list(r[:5]) for r in rows]
        self.cls = [r[5] for r in rows]
        self.conf = [r[6] for r in rows]


class SegBoxes:
    def __init__(self, cls, conf):
        self.cls, self.conf = cls, conf

    def __iter__(self):
        raise AssertionError("a segmentation result's detection is its mask outline, not its box")


class Masks:
    def __init__(self, rings):
        self.xy = rings


class Result:
    def __init__(self, *, boxes=None, obb=None, masks=None):
        self.boxes, self.obb, self.masks = boxes, obb, masks


def provider(device="0"):
    return LocalYoloProvider(Path("w.pt"), {"crack": "Crack"}, device=device)


def test_an_obb_result_becomes_rotated_boxes_in_full_image_pixels():
    r = Result(obb=Obb([(100, 50, 40, 20, math.pi / 6, 0, 0.9)]))
    [d] = provider()._from_result(r, NAMES, TILE, "ref")
    assert d.shape == "rbox" and d.label == "Crack" and d.raw_ref == "ref"
    assert (d.x, d.y, d.w, d.h) == pytest.approx((800.0, 40.0, 40.0, 20.0))
    assert d.angle == pytest.approx(30.0)
    assert d.confidence == pytest.approx(0.9)


def test_an_obb_angle_is_normalised_into_0_180():
    r = Result(obb=Obb([(100, 50, 40, 20, -math.pi / 6, 0, 0.9)]))
    [d] = provider()._from_result(r, NAMES, TILE, "")
    assert d.angle == pytest.approx(150.0)


def test_an_unmapped_obb_class_is_dropped():
    r = Result(obb=Obb([(100, 50, 40, 20, 0.3, 1, 0.9)]))
    assert provider()._from_result(r, NAMES, TILE, "") == []


def test_a_mask_result_becomes_a_polygon_offset_into_the_image():
    ring = [[10, 10], [60, 10], [60, 40], [10, 40]]
    r = Result(boxes=SegBoxes([0], [0.8]), masks=Masks([ring]))
    [d] = provider()._from_result(r, NAMES, TILE, "")
    assert d.shape == "polygon" and d.confidence == pytest.approx(0.8)
    assert sorted(d.polygon) == sorted([(730.0, 10.0), (780.0, 10.0), (780.0, 40.0), (730.0, 40.0)])
    assert (d.x, d.y, d.w, d.h) == (730.0, 10.0, 50.0, 30.0)


def test_a_dense_outline_is_simplified_and_a_sliver_is_dropped():
    circle = [
        [300 + 100 * math.cos(2 * math.pi * t / 3000), 300 + 100 * math.sin(2 * math.pi * t / 3000)]
        for t in range(3000)
    ]
    r = Result(boxes=SegBoxes([0, 0], [0.9, 0.7]), masks=Masks([circle, [[0, 0], [1, 0]]]))
    dets = provider()._from_result(r, NAMES, TILE, "")
    assert len(dets) == 1
    assert 3 <= len(dets[0].polygon) <= 256


@pytest.fixture
def frame(tmp_path) -> Path:
    path = tmp_path / "f.jpg"
    PILImage.new("RGB", (640, 480), "grey").save(path, "JPEG")
    return path


class FakeYolo:
    names = {0: "crack"}

    def __init__(self):
        self.devices: list[str] = []

    def predict(self, source, **kwargs):
        self.devices.append(kwargs["device"])
        return [Result(obb=Obb([(100, 50, 40, 20, 0.5, 0, 0.9)]))]


def test_the_cpu_path_never_waits_for_the_gpu(frame, monkeypatch):
    fake = FakeYolo()
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    gpu_lock.acquire()
    try:
        started = time.monotonic()
        dets = provider("cpu").detect(frame, "", [], TilingSpec(enabled=False), conf=0.25, log=LOG)
        waited = time.monotonic() - started
    finally:
        gpu_lock.release()
    assert waited < 1.0
    assert fake.devices == ["cpu"] and len(dets) == 1 and dets[0].shape == "rbox"


def test_the_cpu_model_has_its_own_slot(monkeypatch):
    from app.providers import local_yolo

    monkeypatch.setattr(local_yolo, "_MODEL", None)
    monkeypatch.setattr(local_yolo, "_CPU_MODEL", None)
    monkeypatch.setattr(local_yolo, "_set_cpu_threads", lambda: None)
    monkeypatch.setattr(local_yolo, "_new_yolo", lambda key: object())

    gpu = local_yolo._load(Path("a.pt"), "0")
    cpu = local_yolo._load(Path("a.pt"), "cpu")
    assert cpu is not gpu
    assert local_yolo._load(Path("a.pt"), "0") is gpu  # a CPU call never evicts a job's GPU model
    assert local_yolo._load(Path("a.pt"), "cpu") is cpu
