"""Training parameter presets and the mapping onto Ultralytics keyword arguments (spec section 7)."""

import dataclasses
from pathlib import Path

import pytest

from app.training.presets import PRESETS, TrainParams, to_ultralytics_kwargs

FLIP_KEYS = ("flipud", "fliplr", "degrees")


def params(**over) -> TrainParams:
    base = {
        "data_yaml": "C:/p/datasets/v1/data.yaml",
        "base_weights": "C:/p/models/a.pt",
        "run_dir": "C:/p/runs/j1",
    }
    return TrainParams(**{**base, **over})


def test_defaults_match_the_contract_defaults():
    p = params()
    actual = (p.epochs, p.imgsz, p.batch, p.patience, p.augmentation, p.device)
    assert actual == (50, 1280, None, 50, "default", "0")


def test_default_kwargs():
    kw = to_ultralytics_kwargs(params())
    assert kw["epochs"] == 50
    assert kw["imgsz"] == 1280
    assert kw["batch"] == -1  # Ultralytics auto batch
    assert kw["patience"] == 50
    assert kw["device"] == "0"
    assert kw["name"] == "train"
    assert kw["exist_ok"] is True
    assert kw["plots"] is True
    assert kw["verbose"] is False
    assert kw["amp"] == "bf16"  # no AMP probe, so no one-time yolo26n.pt download
    assert kw["project"] == str(Path("C:/p/runs/j1"))
    assert not any(k in kw for k in FLIP_KEYS)
    assert "data" not in kw and "model" not in kw


def test_aerial_preset_adds_flips_and_rotation():
    kw = to_ultralytics_kwargs(params(augmentation="aerial"))
    assert kw["flipud"] == 0.5
    assert kw["fliplr"] == 0.5
    assert kw["degrees"] == 90.0


def test_explicit_batch_passes_through():
    assert to_ultralytics_kwargs(params(batch=8))["batch"] == 8


def test_unknown_preset_raises():
    with pytest.raises(ValueError):
        to_ultralytics_kwargs(params(augmentation="nope"))


def test_presets_table():
    assert PRESETS["default"] == {}
    assert PRESETS["aerial"] == {"flipud": 0.5, "fliplr": 0.5, "degrees": 90.0}


def test_params_are_frozen():
    with pytest.raises(dataclasses.FrozenInstanceError):
        params().epochs = 3


def test_cpu_training_turns_mixed_precision_off():
    assert to_ultralytics_kwargs(params(device="cpu"))["amp"] is False
