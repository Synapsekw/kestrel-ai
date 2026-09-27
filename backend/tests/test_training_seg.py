"""Segmentation training bits: seg starters, (M) metric parsing, the model metrics shape
(image spec §11.5; plan I-BT Task 5)."""

import csv
import io

import pytest
from library_helpers import stub_checkpoint

from app.jobs.cancellation import JobFailure
from app.training import starter
from app.training.schemas import ModelMetrics
from app.training.worker import mask_metrics_from

# The header and one row of an Ultralytics 8.4 segment `results.csv` (columns as the trainer writes them).
RESULTS_CSV = (
    "epoch,time,train/box_loss,train/seg_loss,train/cls_loss,train/dfl_loss,"
    "metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B),"
    "metrics/precision(M),metrics/recall(M),metrics/mAP50(M),metrics/mAP50-95(M),"
    "val/box_loss,val/seg_loss,val/cls_loss,val/dfl_loss,lr/pg0,lr/pg1,lr/pg2\n"
    "1,12.5,1.2,2.4,3.1,1.1,0.51,0.42,0.47,0.30,0.49,0.40,0.412,0.219,1.3,2.5,3.2,1.2,0.001,0.001,0.001\n"
)


def last_row(text: str) -> dict:
    return list(csv.DictReader(io.StringIO(text)))[-1]


def test_mask_metrics_are_read_from_a_results_csv_row():
    assert mask_metrics_from(last_row(RESULTS_CSV)) == {"mask_map50": 0.412, "mask_map50_95": 0.219}


def test_mask_metrics_tolerate_padded_keys_and_numbers():
    assert mask_metrics_from({"  metrics/mAP50(M)": 0.5, "metrics/mAP50-95(M) ": "0.25"}) == {
        "mask_map50": 0.5,
        "mask_map50_95": 0.25,
    }


def test_a_detect_run_has_no_mask_metrics():
    assert mask_metrics_from({"metrics/mAP50(B)": 0.7}) == {"mask_map50": None, "mask_map50_95": None}
    assert mask_metrics_from({"metrics/mAP50(M)": "nan"}) == {"mask_map50": None, "mask_map50_95": None}


def test_model_metrics_mask_fields_default_to_null_for_old_rows():
    m = ModelMetrics(map50=0.7, map50_95=0.4, precision=0.8, recall=0.6)
    assert m.mask_map50 is None and m.mask_map50_95 is None


def test_the_catalogue_has_three_segment_starters(tmp_path):
    items = {i["key"]: i for i in starter.list_starters(tmp_path)}
    for scale, size in (("n", "nano"), ("s", "small"), ("m", "medium")):
        item = items[f"yolo11{scale}-seg"]
        assert item["task"] == "segment" and item["family"] == "YOLO11-seg"
        assert item["name"] == f"YOLO11 {size} segmentation"
    assert items["yolo11n"]["task"] == "detect"


def test_a_seg_starter_imports_as_a_segment_model(client, app, tmp_path, monkeypatch):
    (tmp_path / "yolo11n-seg.pt").write_bytes(b"s" * 1000)
    stub_checkpoint(monkeypatch, task="segment", names=["person", "truck"])
    row = starter.import_starter(app.state.library, tmp_path, "yolo11n-seg", None)
    assert row.task == "segment"


def test_a_seg_starter_whose_checkpoint_is_a_detector_is_refused(client, app, tmp_path, monkeypatch):
    (tmp_path / "yolo11n-seg.pt").write_bytes(b"d" * 1000)
    stub_checkpoint(monkeypatch, task="detect")
    with pytest.raises(JobFailure, match="requires a segment checkpoint"):
        starter.import_starter(app.state.library, tmp_path, "yolo11n-seg", None)
