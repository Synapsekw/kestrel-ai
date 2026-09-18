"""Training and export subprocess entry point (`python -m app.training.worker <cmd> <params.json>`).

This module is the only place that imports ultralytics, and it does so inside the run functions so
that the API process can import the helpers below without loading torch. It writes `progress.jsonl`
and `done.json` into the run folder and mirrors progress lines on stdout for the job log.
"""

import json
import os
import sys
import time
import traceback
from collections.abc import Callable
from pathlib import Path

from app.training.presets import TrainParams, to_ultralytics_kwargs

LOSS_NAMES_FALLBACK = ("box_loss", "cls_loss", "dfl_loss")


def _is_number(v) -> bool:
    try:
        float(v)
    except (TypeError, ValueError):
        return False
    return True


def _num(value) -> float:
    """A plain float from a numpy scalar, a 0-d array or a per-threshold row (averaged)."""
    if getattr(value, "ndim", 0) > 0:
        values = [float(v) for v in value]
        return sum(values) / len(values) if values else 0.0
    return float(value)


def _class_name(names, index: int) -> str:
    if isinstance(names, dict):
        return str(names.get(index, names.get(str(index), index)))
    try:
        return str(names[index])
    except (IndexError, KeyError, TypeError):
        return str(index)


def epoch_event(epoch: int, epochs: int, metrics: dict, loss: dict, elapsed: float) -> dict:
    """One `progress.jsonl` line after a fit epoch. ETA extrapolates the mean epoch time."""
    eta = (elapsed / epoch) * (epochs - epoch) if epoch > 0 else 0.0
    return {
        "kind": "epoch",
        "epoch": int(epoch),
        "epochs": int(epochs),
        "metrics": {str(k): float(v) for k, v in (metrics or {}).items() if _is_number(v)},
        "loss": {str(k): float(v) for k, v in (loss or {}).items() if _is_number(v)},
        "elapsed_s": round(float(elapsed), 3),
        "eta_s": round(max(0.0, float(eta)), 3),
    }


def cuda_bf16_supported() -> bool:
    """True only for native bf16; emulation is not worth the autocast overhead."""
    import torch

    try:
        return bool(torch.cuda.is_bf16_supported(including_emulation=False))
    except TypeError:  # older torch without the keyword
        return bool(torch.cuda.is_bf16_supported())
    except Exception:
        return False


def amp_setting(device: str, bf16_supported: Callable[[], bool] = cuda_bf16_supported) -> bool | str:
    """Mixed precision for this run, chosen without Ultralytics' AMP probe.

    The probe downloads a checkpoint the first time a machine trains on CUDA, which a packaged
    offline app cannot rely on (spec section 10). `bf16` skips it, but Ultralytics hands the value
    straight to autocast, so it is only safe where the GPU supports bf16 natively; everything else
    trains in fp32.
    """
    if device.strip().lower() == "cpu":
        return False
    return "bf16" if bf16_supported() else False


def is_new_fit_epoch(last_epoch: int, epoch: int, epochs: int) -> bool:
    """True for the first callback of a real fit epoch.

    Ultralytics fires `on_fit_epoch_end` once more after training, for its final validation, with
    `epoch` one past the last one; that replay carries no new training progress.
    """
    return last_epoch < epoch <= epochs


def final_metrics_from(box, names) -> dict:
    """Contract `ModelMetrics` from an ultralytics `DetMetrics.box`-shaped object."""
    indices = getattr(box, "ap_class_index", None)
    per_class = []
    for i, class_index in enumerate([] if indices is None else list(indices)):
        per_class.append(
            {
                "class_name": _class_name(names, int(class_index)),
                "map50": _num(box.ap50[i]),
                "map50_95": _num(box.ap[i]),
                "precision": _num(box.p[i]),
                "recall": _num(box.r[i]),
            }
        )
    return {
        "map50": _num(box.map50),
        "map50_95": _num(box.map),
        "precision": _num(box.mp),
        "recall": _num(box.mr),
        "per_class": per_class,
    }


class ProgressWriter:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, event: dict) -> None:
        line = json.dumps(event)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        print(line, flush=True)  # the job log captures the subprocess stdout


def write_done(run_dir: Path, payload: dict) -> None:
    """Atomic: the parent only ever sees a complete done.json."""
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    tmp = run_dir / "done.json.tmp"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(run_dir / "done.json")


def losses_from(trainer) -> dict:
    """The running loss terms. Ultralytics 8.4 keeps a dict; older releases a tensor plus names."""
    tloss = getattr(trainer, "tloss", None)
    if tloss is None:
        return {}
    if isinstance(tloss, dict):
        return {str(k): float(v) for k, v in tloss.items() if _is_number(v)}
    try:
        values = [float(v) for v in tloss.tolist()]
    except (AttributeError, TypeError, ValueError):
        return {}
    names = list(getattr(trainer, "loss_names", None) or LOSS_NAMES_FALLBACK)
    return dict(zip(names, values, strict=False))


def run_train(params: dict) -> dict:
    from ultralytics import YOLO

    p = TrainParams(**params)
    progress = ProgressWriter(Path(p.run_dir) / "progress.jsonl")
    final: dict = {}
    written = {"epoch": 0}

    def on_train_start(trainer):
        progress.write({"kind": "start", "epochs": int(getattr(trainer, "epochs", p.epochs) or p.epochs)})

    def on_fit_epoch_end(trainer):
        epoch = int(getattr(trainer, "epoch", 0)) + 1
        epochs = int(getattr(trainer, "epochs", p.epochs) or p.epochs)
        if not is_new_fit_epoch(written["epoch"], epoch, epochs):
            return
        written["epoch"] = epoch
        started = getattr(trainer, "train_time_start", None)
        elapsed = time.time() - started if started else 0.0
        metrics = dict(getattr(trainer, "metrics", {}) or {})
        progress.write(epoch_event(epoch, epochs, metrics, losses_from(trainer), elapsed))

    def on_train_end(trainer):
        box = getattr(getattr(getattr(trainer, "validator", None), "metrics", None), "box", None)
        if box is not None:
            final.update(final_metrics_from(box, (getattr(trainer, "data", {}) or {}).get("names", {})))

    model = YOLO(p.base_weights)
    model.add_callback("on_train_start", on_train_start)
    model.add_callback("on_fit_epoch_end", on_fit_epoch_end)
    model.add_callback("on_train_end", on_train_end)
    kwargs = to_ultralytics_kwargs(p)
    kwargs["amp"] = amp_setting(p.device)
    model.train(data=p.data_yaml, **kwargs)

    trainer = model.trainer
    save_dir = Path(trainer.save_dir)
    best = Path(getattr(trainer, "best", None) or save_dir / "weights" / "best.pt")
    return {"ok": True, "best": str(best), "save_dir": str(save_dir), "final_metrics": final}


def run_export(params: dict) -> dict:
    from ultralytics import YOLO

    model = YOLO(params["weights"])
    path = model.export(
        format=params["format"],
        imgsz=int(params.get("imgsz", 1280)),
        half=bool(params.get("half", False)),
        device=params.get("device", "0"),
    )
    return {"ok": True, "path": str(Path(str(path)).resolve())}


def main(argv: list[str]) -> int:
    os.environ.setdefault("YOLO_VERBOSE", "False")
    # Never let ultralytics pip-install into the user's environment; a missing optional
    # dependency (for example onnx) has to surface as a job error, not as a silent install.
    os.environ.setdefault("YOLO_AUTOINSTALL", "False")
    if len(argv) < 2 or argv[0] not in ("train", "export"):
        print("usage: worker (train|export) <params.json>", file=sys.stderr)
        return 2
    command, params_json = argv[0], Path(argv[1])
    run_dir = params_json.parent  # the launcher writes params.json into the run folder
    try:
        params = json.loads(params_json.read_text(encoding="utf-8"))
        run_dir = Path(params.get("run_dir") or run_dir)
        payload = run_train(params) if command == "train" else run_export(params)
    except Exception as e:
        traceback.print_exc()
        write_done(run_dir, {"ok": False, "error": repr(e)})
        return 1
    write_done(run_dir, payload)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
