"""In-process test doubles. `FakeTrainer` stands in for `UltralyticsTrainer` in job tests.

It honours the same contract: it reports progress per epoch, checks the cancellation event, writes
the run artifacts Ultralytics would write, and raises `RuntimeError` when asked to fail.
"""

import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.jobs.runner import JobCancelled
from app.training.presets import TrainParams
from app.training.trainer import TrainResult

RESULTS_COLUMNS = (
    "epoch,time,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision(B),metrics/recall(B),"
    "metrics/mAP50(B),metrics/mAP50-95(B),val/box_loss,val/cls_loss,val/dfl_loss"
)


class FakeTrainer:
    def __init__(
        self,
        map50: float = 0.5,
        map50_95: float = 0.3,
        precision: float = 0.6,
        recall: float = 0.4,
        per_class: list[dict] | None = None,
        fail: bool | str | None = None,
        epoch_sleep_s: float = 0.02,
    ):
        self.metrics = {
            "map50": map50,
            "map50_95": map50_95,
            "precision": precision,
            "recall": recall,
            "per_class": per_class
            if per_class is not None
            else [
                {
                    "class_name": "excavator",
                    "map50": map50,
                    "map50_95": map50_95,
                    "precision": precision,
                    "recall": recall,
                }
            ],
        }
        self.fail = fail
        self.epoch_sleep_s = epoch_sleep_s

    def _boom(self) -> None:
        if self.fail:
            raise RuntimeError(self.fail if isinstance(self.fail, str) else "fake trainer failure")

    def train(
        self,
        params: TrainParams,
        on_progress: Callable[[float, str], None],
        cancelled: threading.Event,
        log: logging.Logger,
    ) -> TrainResult:
        save_dir = Path(params.run_dir) / "train"
        (save_dir / "weights").mkdir(parents=True, exist_ok=True)
        rows = [RESULTS_COLUMNS]
        for epoch in range(1, params.epochs + 1):
            if cancelled.is_set():
                raise JobCancelled()
            time.sleep(self.epoch_sleep_s)
            self._boom()
            rows.append(
                f"{epoch},{epoch * 1.0},1.0,0.9,0.8,{self.metrics['precision']},{self.metrics['recall']},"
                f"{self.metrics['map50']},{self.metrics['map50_95']},1.0,0.9,0.8"
            )
            log.info("fake epoch %s/%s", epoch, params.epochs)
            on_progress(
                epoch / params.epochs, f"epoch {epoch}/{params.epochs} mAP50 {self.metrics['map50']:.3f}"
            )
        (save_dir / "weights" / "best.pt").write_bytes(b"\0")
        (save_dir / "results.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
        (save_dir / "confusion_matrix.png").write_bytes(b"\x89PNG")
        return TrainResult.from_save_dir(save_dir / "weights" / "best.pt", save_dir, dict(self.metrics))

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
        if cancelled.is_set():
            raise JobCancelled()
        self._boom()
        out = Path(weights).with_suffix(f".{fmt}")
        out.write_bytes(b"fake-export")
        return out
