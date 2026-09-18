"""The JSON-lines progress protocol between the training subprocess and the job thread."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from app.training.trainer import latest_epoch, progress_fraction, read_progress
from app.training.worker import epoch_event, final_metrics_from


def write_lines(path: Path, events: list[dict], truncate_last: bool = False) -> None:
    text = "".join(json.dumps(e) + "\n" for e in events)
    if truncate_last:
        text += json.dumps({"kind": "epoch", "epoch": 99})[:12]  # half a line, no newline
    path.write_text(text, encoding="utf-8")


def epochs(n: int, total: int) -> list[dict]:
    return [{"kind": "start", "epochs": total}] + [
        {"kind": "epoch", "epoch": i, "epochs": total, "metrics": {"metrics/mAP50(B)": 0.1 * i}}
        for i in range(1, n + 1)
    ]


def test_read_progress_missing_file_is_empty(tmp_path):
    assert read_progress(tmp_path / "nope.jsonl") == []


def test_read_progress_tolerates_a_partially_written_last_line(tmp_path):
    p = tmp_path / "progress.jsonl"
    write_lines(p, epochs(2, 10), truncate_last=True)
    events = read_progress(p)
    assert [e["kind"] for e in events] == ["start", "epoch", "epoch"]
    assert events[-1]["epoch"] == 2


def test_progress_fraction_is_epoch_over_epochs(tmp_path):
    assert progress_fraction(epochs(3, 10)) == 0.3
    assert progress_fraction([]) == 0.0
    assert progress_fraction([{"kind": "start", "epochs": 10}]) == 0.0


def test_progress_fraction_is_clamped_to_one():
    assert progress_fraction([{"kind": "epoch", "epoch": 12, "epochs": 10}]) == 1.0


def test_latest_epoch_returns_the_last_epoch_event():
    assert latest_epoch(epochs(3, 10))["epoch"] == 3
    assert latest_epoch([{"kind": "start", "epochs": 10}]) is None


def test_epoch_event_shape_and_eta():
    e = epoch_event(3, 10, {"metrics/mAP50(B)": 0.31}, {"box_loss": 1.2}, 30.0)
    assert e["kind"] == "epoch"
    assert e["epoch"] == 3
    assert e["epochs"] == 10
    assert e["metrics"] == {"metrics/mAP50(B)": 0.31}
    assert e["loss"] == {"box_loss": 1.2}
    assert e["elapsed_s"] == 30.0
    assert e["eta_s"] == 70.0  # 30 s for 3 epochs -> 10 s each -> 7 left
    assert json.loads(json.dumps(e)) == e  # JSON serialisable


def test_epoch_event_first_epoch_never_divides_by_zero():
    assert epoch_event(0, 10, {}, {}, 0.0)["eta_s"] == 0.0


class FakeBox:
    """Stands in for ultralytics `DetMetrics.box`."""

    map50 = np.float64(0.71)
    map = np.float64(0.44)
    mp = np.float64(0.78)
    mr = np.float64(0.66)
    ap_class_index = np.array([0, 2])
    ap50 = np.array([0.80, 0.62])
    ap = np.array([0.50, 0.38])
    p = np.array([0.82, 0.74])
    r = np.array([0.70, 0.62])


def test_final_metrics_from_box_metrics():
    m = final_metrics_from(FakeBox(), {0: "excavator", 1: "crane", 2: "dump_truck"})
    assert m["map50"] == 0.71
    assert m["map50_95"] == 0.44
    assert m["precision"] == 0.78
    assert m["recall"] == 0.66
    assert m["per_class"] == [
        {"class_name": "excavator", "map50": 0.80, "map50_95": 0.50, "precision": 0.82, "recall": 0.70},
        {"class_name": "dump_truck", "map50": 0.62, "map50_95": 0.38, "precision": 0.74, "recall": 0.62},
    ]
    assert json.loads(json.dumps(m)) == m  # plain floats, not numpy


def test_final_metrics_from_accepts_a_names_list():
    m = final_metrics_from(FakeBox(), ["excavator", "crane", "dump_truck"])
    assert [c["class_name"] for c in m["per_class"]] == ["excavator", "dump_truck"]


def test_final_metrics_from_averages_multi_threshold_ap():
    class Box(FakeBox):
        ap = np.array([[0.5, 0.3], [0.4, 0.2]])  # (class, iou threshold)

    m = final_metrics_from(Box(), {0: "a", 2: "b"})
    assert m["per_class"][0]["map50_95"] == 0.4


def test_the_api_process_does_not_load_torch_or_ultralytics(backend_dir):
    """Spec section 7: the ML stack only lives in the worker subprocess."""
    code = (
        "import sys, app.api, app.training.trainer, app.training.worker, app.training.presets;"
        "print(int('torch' in sys.modules), int('ultralytics' in sys.modules))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=backend_dir, capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == "0 0", out.stdout


def test_main_dispatches_the_worker_subcommand(backend_dir):
    out = subprocess.run(
        [sys.executable, "-m", "app", "worker"], cwd=backend_dir, capture_output=True, text=True
    )
    assert out.returncode == 2
    assert "usage: worker" in out.stderr
