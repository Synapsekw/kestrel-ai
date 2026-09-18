"""Training parameters and their mapping onto Ultralytics keyword arguments (spec section 7).

Imports nothing from ultralytics or torch: the API process builds these parameters, the
worker subprocess is the only place that loads the ML stack.
"""

from dataclasses import dataclass
from pathlib import Path

# Augmentation presets (spec section 15: Ultralytics defaults plus flips and 90 degree rotations).
PRESETS: dict[str, dict] = {
    "default": {},
    "aerial": {"flipud": 0.5, "fliplr": 0.5, "degrees": 90.0},
}


@dataclass(frozen=True)
class TrainParams:
    """One training run. Paths are absolute; defaults match `TrainRequest` in the contract."""

    data_yaml: str
    base_weights: str
    run_dir: str
    epochs: int = 50
    imgsz: int = 1280
    batch: int | None = None  # None = Ultralytics auto batch
    patience: int = 50
    augmentation: str = "default"
    device: str = "0"


def to_ultralytics_kwargs(p: TrainParams) -> dict:
    """Keyword arguments for `YOLO(...).train(data=..., **kwargs)`; `data` and `model` stay out."""
    try:
        preset = PRESETS[p.augmentation]
    except KeyError:
        raise ValueError(f"unknown augmentation preset {p.augmentation!r}") from None
    return {
        "epochs": p.epochs,
        "imgsz": p.imgsz,
        "batch": -1 if p.batch is None else p.batch,
        "patience": p.patience,
        "device": p.device,
        "project": str(Path(p.run_dir)),
        "name": "train",
        "exist_ok": True,
        "plots": True,
        "verbose": False,
        # bf16 mixed precision skips the Ultralytics AMP probe, which downloads a probe checkpoint
        # the first time a machine trains; the packaged app has to work offline (spec section 10).
        "amp": False if p.device == "cpu" else "bf16",
        **preset,
    }
