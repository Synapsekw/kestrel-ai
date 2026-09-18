"""Trainer interface and the progress-file reader (spec section 7).

The API process never imports ultralytics or torch: training and export run in a
subprocess (`app.training.worker`) that writes `progress.jsonl` and `done.json` into the
run folder, and the job thread tails those files.
"""

import json
import logging
import os
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from app.jobs.runner import JobCancelled
from app.training.presets import TrainParams

PR_CURVE_NAMES = ("BoxPR_curve.png", "PR_curve.png")
POLL_S = 0.5
TERMINATE_GRACE_S = 10.0
CREATE_NEW_PROCESS_GROUP = 0x00000200


@dataclass
class TrainResult:
    best_weights: Path
    save_dir: Path
    final_metrics: dict
    results_csv: Path | None = None
    confusion_matrix: Path | None = None
    pr_curve: Path | None = None

    @classmethod
    def from_save_dir(cls, best_weights: Path, save_dir: Path, final_metrics: dict) -> "TrainResult":
        """Resolve the run artifacts Ultralytics writes next to the weights; missing ones stay None."""

        def existing(*names: str) -> Path | None:
            for n in names:
                p = save_dir / n
                if p.exists():
                    return p
            return None

        return cls(
            best_weights=best_weights,
            save_dir=save_dir,
            final_metrics=final_metrics,
            results_csv=existing("results.csv"),
            confusion_matrix=existing("confusion_matrix.png"),
            pr_curve=existing(*PR_CURVE_NAMES),
        )


class Trainer(Protocol):
    def train(
        self,
        params: TrainParams,
        on_progress: Callable[[float, str], None],
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> TrainResult: ...

    def export(
        self,
        weights: Path,
        fmt: str,
        imgsz: int,
        half: bool,
        device: str,
        run_dir: Path,
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> Path: ...


def read_progress(path: Path) -> list[dict]:
    """All complete JSON lines written so far; a half-written last line is skipped."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    events: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except ValueError:
            continue  # the worker is mid-write; the line arrives complete on the next poll
        if isinstance(value, dict):
            events.append(value)
    return events


def latest_epoch(events: list[dict]) -> dict | None:
    for e in reversed(events):
        if e.get("kind") == "epoch":
            return e
    return None


def progress_fraction(events: list[dict]) -> float:
    e = latest_epoch(events)
    if not e:
        return 0.0
    total = float(e.get("epochs") or 0)
    if total <= 0:
        return 0.0
    return max(0.0, min(1.0, float(e.get("epoch") or 0) / total))


def epoch_message(event: dict) -> str:
    epoch, epochs = event.get("epoch"), event.get("epochs")
    map50 = (event.get("metrics") or {}).get("metrics/mAP50(B)")
    if map50 is None:
        return f"epoch {epoch}/{epochs}"
    return f"epoch {epoch}/{epochs} mAP50 {float(map50):.3f}"


def _job_log_file(log: logging.Logger) -> Path | None:
    for h in getattr(log, "handlers", []):
        filename = getattr(h, "baseFilename", None)
        if filename:
            return Path(filename)
    return None


class UltralyticsTrainer:
    """Runs `app.training.worker` in a subprocess and tails its progress file.

    The API process stays free of torch: everything ML happens on the other side of the pipe, so a
    crash or a cancellation costs at most one subprocess. `process` is the last Popen (tests and
    operators read it; each call starts a fresh one).
    """

    def __init__(self, poll_s: float = POLL_S):
        self.poll_s = poll_s
        self.process: subprocess.Popen | None = None

    def build_command(self, subcommand: str, params_json: Path) -> list[str]:
        if getattr(sys, "frozen", False):
            return [sys.executable, "worker", subcommand, str(params_json)]
        return [sys.executable, "-m", "app.training.worker", subcommand, str(params_json)]

    def cwd(self) -> Path:
        """`app` has to resolve from here: the backend root, or the exe folder when frozen."""
        if getattr(sys, "frozen", False):
            return Path(sys.executable).parent
        return Path(__file__).resolve().parents[2]

    def train(
        self,
        params: TrainParams,
        on_progress: Callable[[float, str], None],
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> TrainResult:
        run_dir = Path(params.run_dir)
        done = self._run("train", asdict(params), run_dir, on_progress, cancelled, log)
        save_dir = Path(done["save_dir"])
        return TrainResult.from_save_dir(Path(done["best"]), save_dir, done.get("final_metrics") or {})

    def export(
        self,
        weights: Path,
        fmt: str,
        imgsz: int,
        half: bool,
        device: str,
        run_dir: Path,
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> Path:
        payload = {
            "weights": str(weights),
            "format": fmt,
            "imgsz": int(imgsz),
            "half": bool(half),
            "device": device,
            "run_dir": str(run_dir),
        }
        done = self._run("export", payload, Path(run_dir), lambda f, m: None, cancelled, log)
        return Path(done["path"])

    def _run(
        self,
        subcommand: str,
        payload: dict,
        run_dir: Path,
        on_progress: Callable[[float, str], None],
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> dict:
        run_dir.mkdir(parents=True, exist_ok=True)
        progress_path = run_dir / "progress.jsonl"
        done_path = run_dir / "done.json"
        for stale in (progress_path, done_path):
            stale.unlink(missing_ok=True)
        params_json = run_dir / "params.json"
        params_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        command = self.build_command(subcommand, params_json)
        log_path = _job_log_file(log) or run_dir / "worker.log"
        log.info("starting %s worker: %s", subcommand, " ".join(command))
        with open(log_path, "a", encoding="utf-8", errors="replace") as sink:
            proc = subprocess.Popen(  # noqa: S603 - fixed command, no shell
                command,
                cwd=str(self.cwd()),
                stdout=sink,
                stderr=subprocess.STDOUT,
                creationflags=CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            self.process = proc
            log.info("%s worker pid %s", subcommand, proc.pid)
            try:
                self._wait(proc, progress_path, on_progress, cancelled, log)
            except BaseException:
                self._terminate_tree(proc, log)
                raise
        return self._done(proc, done_path, subcommand)

    def _wait(
        self,
        proc: subprocess.Popen,
        progress_path: Path,
        on_progress: Callable[[float, str], None],
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> None:
        last_epoch = 0
        while True:
            if cancelled.is_set():
                log.info("cancelling worker pid %s", proc.pid)
                raise JobCancelled()
            events = read_progress(progress_path)
            current = latest_epoch(events)
            if current and int(current.get("epoch") or 0) > last_epoch:
                last_epoch = int(current["epoch"])
                on_progress(progress_fraction(events), epoch_message(current))
            if proc.poll() is not None:
                events = read_progress(progress_path)  # the last lines may have landed after the poll
                current = latest_epoch(events)
                if current and int(current.get("epoch") or 0) > last_epoch:
                    on_progress(progress_fraction(events), epoch_message(current))
                return
            if cancelled.wait(self.poll_s):
                continue  # loop back so the cancellation raises before another poll

    @staticmethod
    def _terminate_tree(proc: subprocess.Popen, log: logging.Logger) -> None:
        """Take the worker and its dataloader children down; only ever our own process tree."""
        if proc.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(  # noqa: S603, S607 - our own pid, no shell
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False
            )
        else:
            proc.terminate()
        try:
            proc.wait(TERMINATE_GRACE_S)
        except subprocess.TimeoutExpired:
            log.warning("worker pid %s did not exit; killing it", proc.pid)
            proc.kill()
            proc.wait(5)

    @staticmethod
    def _done(proc: subprocess.Popen, done_path: Path, subcommand: str) -> dict:
        code = proc.returncode
        try:
            done = json.loads(done_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise RuntimeError(f"{subcommand} worker exited with code {code} without a result") from None
        if not done.get("ok"):
            raise RuntimeError(done.get("error") or f"{subcommand} worker failed")
        if code not in (0, None):
            raise RuntimeError(f"{subcommand} worker exited with code {code}")
        return done


def get_trainer() -> Trainer:
    return UltralyticsTrainer()
