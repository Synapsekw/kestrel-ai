"""The job.progress message carries epoch, mAP50, the loss terms and an ETA (spec section 7)."""

from app.training.trainer import epoch_message


def test_message_carries_loss_terms_and_eta():
    event = {
        "epoch": 2,
        "epochs": 10,
        "metrics": {"metrics/mAP50(B)": 0.5},
        "loss": {"box_loss": 1.2345, "cls_loss": 2.3456, "dfl_loss": 1.1111},
        "eta_s": 252.4,
    }
    assert epoch_message(event) == "epoch 2/10 mAP50 0.500 loss box 1.234 cls 2.346 dfl 1.111 ETA 252s"


def test_message_without_loss_or_eta_is_unchanged():
    assert epoch_message({"epoch": 1, "epochs": 3}) == "epoch 1/3"
    assert (
        epoch_message({"epoch": 1, "epochs": 3, "metrics": {"metrics/mAP50(B)": 0.1}})
        == "epoch 1/3 mAP50 0.100"
    )
    assert epoch_message({"epoch": 1, "epochs": 3, "loss": {}, "eta_s": None}) == "epoch 1/3"


def test_loss_names_are_shortened_from_ultralytics_keys():
    event = {"epoch": 1, "epochs": 3, "loss": {"train/box_loss": 0.5, "seg_loss": 0.25}}
    assert epoch_message(event) == "epoch 1/3 loss box 0.500 seg 0.250"
