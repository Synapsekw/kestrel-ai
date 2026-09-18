"""The local YOLO provider: class mapping, tiled prediction and the shared GPU lock (spec 8)."""

import logging
import threading
import time
from pathlib import Path

import pytest
from PIL import Image as PILImage

from app.jobs.gpu import hold_gpu
from app.providers.base import TilingSpec
from app.providers.local_yolo import LocalYoloProvider, build_class_map

MODEL_CLASSES = ["truck", "car", "person"]
PROJECT_CLASSES = [
    "excavator",
    "wheel_loader",
    "bulldozer",
    "dump_truck",
    "crane",
    "concrete_mixer",
    "roller",
    "backhoe",
]


class FakeBoxes:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class FakeRow:
    def __init__(self, xyxy, cls, conf):
        self.xyxy = [xyxy]
        self.cls = [cls]
        self.conf = [conf]


class FakeResult:
    def __init__(self, rows):
        self.boxes = FakeBoxes(rows)


class FakeYolo:
    """Stands in for `ultralytics.YOLO`: one canned result per predict call, in tile order."""

    def __init__(self, names, per_call):
        self.names = names
        self.per_call = list(per_call)
        self.calls: list[dict] = []

    def predict(self, source, **kwargs):
        self.calls.append(kwargs)
        rows = self.per_call[len(self.calls) - 1] if len(self.calls) <= len(self.per_call) else []
        return [FakeResult(rows)]


@pytest.fixture
def frame(tmp_path) -> Path:
    path = tmp_path / "frame.jpg"
    PILImage.new("RGB", (2000, 1280), "grey").save(path, "JPEG")
    return path


def test_exact_names_map_to_themselves_and_aliases_fill_the_rest():
    model_names = ["truck", "car", "person", "excavator"]
    mapping = build_class_map(model_names, PROJECT_CLASSES, {"truck": "dump_truck"})
    assert mapping == {"truck": "dump_truck", "excavator": "excavator"}


def test_an_alias_pointing_at_an_unknown_project_class_is_dropped():
    assert build_class_map(MODEL_CLASSES, PROJECT_CLASSES, {"truck": "spaceship"}) == {}


def test_an_exact_name_wins_over_an_alias():
    mapping = build_class_map(["excavator"], PROJECT_CLASSES, {"excavator": "crane"})
    assert mapping == {"excavator": "excavator"}


def test_detections_from_two_tiles_are_merged_into_full_image_pixels(frame, monkeypatch):
    # 2000x1280 with tile 1280 / overlap 0.2 gives two tiles at x = 0 and x = 720.
    per_call = [[FakeRow([10, 20, 110, 140], 0.0, 0.9)], [FakeRow([0, 0, 50, 50], 0.0, 0.7)]]
    fake = FakeYolo({0: "truck"}, per_call)
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    provider = LocalYoloProvider(Path("w.pt"), {"truck": "dump_truck"})

    dets = provider.detect(frame, "", PROJECT_CLASSES, TilingSpec(), conf=0.3, log=logging.getLogger("t"))

    assert [(d.label, d.x, d.y, d.w, d.h) for d in sorted(dets, key=lambda d: d.x)] == [
        ("dump_truck", 10.0, 20.0, 100.0, 120.0),
        ("dump_truck", 720.0, 0.0, 50.0, 50.0),
    ]
    assert [c["imgsz"] for c in fake.calls] == [1280, 1280]
    assert all(c["conf"] == 0.3 and c["verbose"] is False for c in fake.calls)


def test_unmapped_model_classes_are_dropped(frame, monkeypatch):
    fake = FakeYolo({0: "truck", 1: "person"}, [[FakeRow([0, 0, 10, 10], 1.0, 0.9)]])
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    provider = LocalYoloProvider(Path("w.pt"), {"truck": "dump_truck"})
    dets = provider.detect(frame, "", PROJECT_CLASSES, TilingSpec(), conf=0.3, log=logging.getLogger("t"))
    assert dets == []


def test_disabled_tiling_predicts_the_whole_image_once(frame, monkeypatch):
    fake = FakeYolo({0: "truck"}, [[FakeRow([10, 20, 110, 140], 0.0, 0.9)]])
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    provider = LocalYoloProvider(Path("w.pt"), {"truck": "dump_truck"}, imgsz=2560)

    dets = provider.detect(
        frame, "", PROJECT_CLASSES, TilingSpec(enabled=False), conf=0.25, log=logging.getLogger("t")
    )

    assert len(fake.calls) == 1
    assert fake.calls[0]["imgsz"] == 2560
    assert (dets[0].x, dets[0].y, dets[0].w, dets[0].h) == (10.0, 20.0, 100.0, 120.0)


def test_overlapping_detections_from_neighbouring_tiles_are_merged(frame, monkeypatch):
    # The same object seen in both tiles: tile 0 at x 800 and tile 1 (origin 720) at x 80.
    fake = FakeYolo(
        {0: "truck"}, [[FakeRow([800, 100, 900, 200], 0.0, 0.6)], [FakeRow([80, 100, 180, 200], 0.0, 0.8)]]
    )
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
    provider = LocalYoloProvider(Path("w.pt"), {"truck": "dump_truck"})
    dets = provider.detect(frame, "", PROJECT_CLASSES, TilingSpec(), conf=0.3, log=logging.getLogger("t"))
    assert len(dets) == 1
    assert dets[0].confidence == pytest.approx(0.8)


def test_hold_gpu_serialises_and_logs_a_long_wait(caplog):
    order: list[str] = []

    def slow():
        with hold_gpu(logging.getLogger("t"), "train"):
            order.append("train in")
            time.sleep(1.4)
            order.append("train out")

    t = threading.Thread(target=slow)
    with caplog.at_level(logging.INFO, logger="t"):
        t.start()
        time.sleep(0.1)
        with hold_gpu(logging.getLogger("t"), "infer"):
            order.append("infer in")
        t.join()

    assert order == ["train in", "train out", "infer in"]
    assert any("waited" in r.message and "infer" in r.message for r in caplog.records)
