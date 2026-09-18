"""Trainer interface and the progress-file reader (spec section 7).

The API process never imports ultralytics or torch: training and export run in a
subprocess (`app.training.worker`) that writes `progress.jsonl` and `done.json` into the
run folder, and the job thread tails those files.
"""

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.training.presets import TrainParams

PR_CURVE_NAMES = ("BoxPR_curve.png", "PR_curve.png")


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
