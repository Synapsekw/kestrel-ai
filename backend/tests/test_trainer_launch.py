"""UltralyticsTrainer: subprocess launch, progress tailing, cancellation and failure reporting.

The stand-in worker (`tests/fake_worker.py`) speaks the same file protocol, so these tests exercise
the launcher without ultralytics or a GPU.
"""

import json
import logging
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from app.jobs.runner import JobCancelled
from app.training.presets import TrainParams
from app.training.trainer import UltralyticsTrainer, get_trainer

FAKE_WORKER = Path(__file__).resolve().parent / "fake_worker.py"


@pytest.fixture
def trainer(monkeypatch, backend_dir) -> UltralyticsTrainer:
    t = UltralyticsTrainer(poll_s=0.05)
    monkeypatch.setattr(
        t, "build_command", lambda cmd, params_json: [sys.executable, str(FAKE_WORKER), cmd, str(params_json)]
    )
    return t


@pytest.fixture
def log() -> logging.Logger:
    return logging.getLogger("test.trainer")


def make_run(tmp_path: Path, **cfg) -> Path:
    run_dir = tmp_path / "runs" / "job1"
    run_dir.mkdir(parents=True)
    if cfg:
        (run_dir / "fake.json").write_text(json.dumps(cfg), encoding="utf-8")
    return run_dir


def params_for(run_dir: Path, epochs: int = 3) -> TrainParams:
    return TrainParams(
        data_yaml=str(run_dir / "data.yaml"),
        base_weights=str(run_dir / "base.pt"),
        run_dir=str(run_dir),
        epochs=epochs,
    )


def test_train_reports_progress_and_returns_artifacts(tmp_path, trainer, log):
    run_dir = make_run(tmp_path, epoch_sleep_s=0.05)
    seen: list[tuple[float, str]] = []
    result = trainer.train(params_for(run_dir), lambda f, m: seen.append((f, m)), threading.Event(), log)

    assert [round(f, 3) for f, _ in seen][-1] == 1.0
    messages = [m for _, m in seen if m]
    heads = [m.split(" loss ")[0] for m in messages]
    # Each poll reports the latest epoch, so a slow poll can skip one (CI did, 2026-09-21); what
    # holds is that epochs only move forward and the last one is always reported.
    expected = ["epoch 1/3 mAP50 0.100", "epoch 2/3 mAP50 0.200", "epoch 3/3 mAP50 0.300"]
    assert heads == sorted(set(heads), key=expected.index)
    assert heads[-1] == "epoch 3/3 mAP50 0.300"
    # The worker's loss terms and ETA ride along on every epoch message (spec section 7).
    assert all(" loss box " in m and " ETA " in m and m.endswith("s") for m in messages)
    assert seen[-1][1].endswith("ETA 0s")
    assert result.best_weights == run_dir / "train" / "weights" / "best.pt"
    assert result.save_dir == run_dir / "train"
    assert result.results_csv == run_dir / "train" / "results.csv"
    assert result.confusion_matrix == run_dir / "train" / "confusion_matrix.png"
    assert result.pr_curve == run_dir / "train" / "BoxPR_curve.png"
    assert result.final_metrics["map50"] == 0.5
    assert json.loads((run_dir / "params.json").read_text(encoding="utf-8"))["epochs"] == 3


def test_train_writes_the_subprocess_output_to_the_job_log(tmp_path, trainer, backend_dir):
    run_dir = make_run(tmp_path, epoch_sleep_s=0.01)
    log_path = tmp_path / "job.log"
    logger = logging.getLogger(f"test.joblog.{tmp_path.name}")
    logger.propagate = False
    handler = logging.FileHandler(log_path, encoding="utf-8")
    logger.addHandler(handler)
    try:
        trainer.train(params_for(run_dir, epochs=1), lambda f, m: None, threading.Event(), logger)
    finally:
        logger.removeHandler(handler)
        handler.close()
    assert '"kind": "epoch"' in log_path.read_text(encoding="utf-8")


def test_cancellation_kills_the_process_and_raises(tmp_path, trainer, log):
    run_dir = make_run(tmp_path, epoch_sleep_s=0.05, epochs_before_hang=1)
    cancelled = threading.Event()

    def on_progress(fraction, message):
        if fraction > 0:
            cancelled.set()  # cancel as soon as the first epoch lands

    started = time.monotonic()
    with pytest.raises(JobCancelled):
        trainer.train(params_for(run_dir, epochs=10), on_progress, cancelled, log)
    assert time.monotonic() - started < 15
    assert trainer.process.poll() is not None  # the subprocess is gone
    time.sleep(0.5)
    assert not (run_dir / "finished.txt").exists()  # and it never got to finish its work


def test_worker_failure_becomes_a_runtime_error(tmp_path, trainer, log):
    run_dir = make_run(tmp_path, fail="CUDA out of memory")
    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        trainer.train(params_for(run_dir), lambda f, m: None, threading.Event(), log)


def test_worker_dying_without_done_json_becomes_a_runtime_error(tmp_path, trainer, log):
    run_dir = make_run(tmp_path, skip_done=True, exit_code=7)
    with pytest.raises(RuntimeError, match="7"):
        trainer.train(params_for(run_dir), lambda f, m: None, threading.Event(), log)


def test_export_runs_the_worker_and_returns_the_path(tmp_path, trainer, log):
    run_dir = make_run(tmp_path)
    weights = tmp_path / "models" / "a.pt"
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"\0")
    out = trainer.export(weights, "onnx", 320, False, "cpu", run_dir, threading.Event(), log)
    assert out == run_dir / "exported.onnx"
    assert out.exists()
    written = json.loads((run_dir / "params.json").read_text(encoding="utf-8"))
    assert written == {
        "weights": str(weights),
        "format": "onnx",
        "imgsz": 320,
        "half": False,
        "device": "cpu",
        "run_dir": str(run_dir),
    }


def test_get_trainer_returns_the_ultralytics_trainer():
    assert isinstance(get_trainer(), UltralyticsTrainer)


def test_build_command_targets_the_worker_module():
    cmd = UltralyticsTrainer().build_command("train", Path("C:/p/runs/j/params.json"))
    assert cmd == [sys.executable, "-m", "app.training.worker", "train", "C:\\p\\runs\\j\\params.json"]


def test_build_command_uses_the_frozen_subcommand(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    cmd = UltralyticsTrainer().build_command("export", Path("C:/p/runs/j/params.json"))
    assert cmd[:3] == [sys.executable, "worker", "export"]


def test_the_worker_module_runs_from_the_trainer_cwd(backend_dir):
    """`python -m app.training.worker` only resolves with backend/ as the working directory."""
    t = UltralyticsTrainer()
    out = subprocess.run(
        [*t.build_command("train", Path("missing.json"))[:3], "--help"],
        cwd=t.cwd(),
        capture_output=True,
        text=True,
    )
    assert t.cwd() == backend_dir
    assert "usage: worker" in out.stderr


# --------------------------------------------------------------- the in-process fake


def test_fake_trainer_matches_the_trainer_contract(tmp_path, log):
    from fakes import FakeTrainer

    run_dir = tmp_path / "runs" / "j"
    t = FakeTrainer(map50=0.42)
    seen: list[tuple[float, str]] = []
    result = t.train(params_for(run_dir, epochs=2), lambda f, m: seen.append((f, m)), threading.Event(), log)
    assert [round(f, 2) for f, _ in seen] == [0.5, 1.0]
    assert result.final_metrics["map50"] == 0.42
    assert result.best_weights.exists()
    assert result.results_csv.exists() and "metrics/mAP50(B)" in result.results_csv.read_text()
    assert result.confusion_matrix.exists()
    out = t.export(result.best_weights, "onnx", 320, False, "cpu", run_dir, threading.Event(), log)
    assert out == result.best_weights.with_suffix(".onnx")
    assert out.exists()


def test_fake_trainer_honours_cancellation_and_failure(tmp_path, log):
    from fakes import FakeTrainer

    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(JobCancelled):
        FakeTrainer().train(params_for(tmp_path / "a", epochs=2), lambda f, m: None, cancelled, log)
    with pytest.raises(RuntimeError, match="boom"):
        FakeTrainer(fail="boom").train(
            params_for(tmp_path / "b", epochs=1), lambda f, m: None, threading.Event(), log
        )
