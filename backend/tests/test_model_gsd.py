"""The scale a model was trained at (spec 2026-09-23-model-training-gsd-design section 2-3).

The numbers are the real senseFly Aeria X frames behind ICVD_V3: focal 18.5 mm, a 23.456 mm
sensor read off FocalPlaneXResolution, flown at a median 191.02 m, letterboxed to imgsz 1280.
"""

import pytest

from app.training.gsd import (
    PLAUSIBLE_M,
    Intrinsics,
    image_gsd_cm,
    intrinsics_from_exif,
    model_gsd_cm,
    plausible,
)

AERIA_X = Intrinsics(focal_mm=18.5, sensor_width_mm=23.4558, source="focal_plane")


class FakeExif:
    """Pillow's Exif exposes the EXIF IFD through get_ifd(0x8769); that is all we read."""

    def __init__(self, ifd: dict):
        self._ifd = ifd

    def get_ifd(self, tag: int) -> dict:
        return self._ifd


def test_sensor_width_from_focal_plane_resolution_in_cm():
    # 6000 px across a sensor sampled at 2558 px/cm is 2.3456 cm.
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA002: 6000, 0xA20E: 2558.0, 0xA210: 3}))
    assert intr is not None
    assert intr.source == "focal_plane"
    assert intr.sensor_width_mm == pytest.approx(23.456, abs=0.01)
    assert intr.focal_mm == pytest.approx(18.5)


def test_sensor_width_from_focal_plane_resolution_in_inches():
    # Same sensor, expressed as 6497.3 px/inch.
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA002: 6000, 0xA20E: 6497.32, 0xA210: 2}))
    assert intr is not None
    assert intr.sensor_width_mm == pytest.approx(23.456, abs=0.05)


def test_sensor_width_falls_back_to_the_35mm_crop_factor():
    intr = intrinsics_from_exif(FakeExif({0x920A: 18.5, 0xA405: 28}))
    assert intr is not None
    assert intr.source == "crop_factor"
    # 36 mm / (28/18.5) = 23.79 mm, within 1.5 % of the focal-plane answer.
    assert intr.sensor_width_mm == pytest.approx(23.79, abs=0.05)


def test_no_focal_length_yields_no_estimate():
    assert intrinsics_from_exif(FakeExif({0xA002: 6000, 0xA20E: 2558.0, 0xA210: 3})) is None


def test_focal_length_alone_is_not_enough():
    assert intrinsics_from_exif(FakeExif({0x920A: 18.5})) is None


def test_the_real_icvd_v3_numbers():
    img = image_gsd_cm(191.02175, AERIA_X, 4000)
    assert img == pytest.approx(6.055, abs=0.01)
    assert model_gsd_cm(img, 4000, 2667, 1280) == pytest.approx(18.92, abs=0.02)


def test_the_letterbox_scales_by_the_long_side():
    img = 6.055
    # Landscape: the width is the long side.
    assert model_gsd_cm(img, 4000, 2667, 1280) == pytest.approx(img * 4000 / 1280)
    # Portrait: the height is, and the long side is still what maps to imgsz.
    assert model_gsd_cm(img, 2667, 4000, 1280) == pytest.approx(img * 4000 / 1280)


def test_plausibility_accepts_real_machinery():
    # ICVD_V3's own classes at 6.055 cm/px: roller 5.07 m ... crane 17.94 m, median 8.51 m.
    assert plausible(8.51) is True
    assert plausible(PLAUSIBLE_M[0] + 0.1) is True
    assert plausible(PLAUSIBLE_M[1] - 0.1) is True


def test_plausibility_rejects_an_order_of_magnitude_error():
    # What the band is for. A 4x altitude error claims 34 m dump trucks; a 10x-too-fine scale
    # claims 0.85 m ones. Both are caught.
    assert plausible(8.51 * 4) is False
    assert plausible(0.85) is False


def test_plausibility_does_not_catch_a_subtle_error():
    # Deliberate, and the reason section 4 asks the operator to confirm: an altitude wrong by 2x
    # still lands on 17 m machines, which is inside the band. The band is a smoke alarm, not a
    # proof. If this test ever fails, the band was narrowed and section 3.3 needs revisiting.
    assert plausible(8.51 * 2) is True


BASE = "/api/v1/projects"
AERIA_EXIF = {
    "focal_mm": 18.5,
    "exif_width": 6000,
    "sensor_px_per_cm": 2558.0,
    "alt": 191.0,
    "lat": 29.0,
    "lon": 47.6,
}


@pytest.fixture
def imported_model(handle):
    from app.db.models import Model

    row = Model(
        name="yolo11m-coco",
        kind="imported",
        weights_path="models/yolo11m.pt",
        dataset_id=None,
        hyperparameters={},
        class_names=["truck"],
    )
    with handle.session() as s:
        s.add(row)
        s.flush()
        model_id = row.id
    return model_id


@pytest.fixture
def trained_model_with_dataset(handle, make_jpeg, tmp_path):
    """A dataset of 12 frames carrying real Aeria X lens EXIF, and a model trained on it.

    Each frame also carries one excavator and one dump_truck box, sized (in stored-image pixels)
    so that at the dataset's ~6.055 cm/px image GSD they imply real objects of roughly 8 m and
    9.5 m: both inside the plausible band, so `plausible` comes back True.
    """
    from app.db.models import Box, Dataset, DatasetImage, Image, Model, Source

    classes = [{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}]
    with handle.session() as s:
        source = Source(folder=str(tmp_path), site="test", image_count=12)
        s.add(source)
        s.flush()
        dataset = Dataset(name="ICVD_V3", classes=classes, split_method="by_group", path="datasets/icvd_v3")
        s.add(dataset)
        s.flush()
        for i in range(12):
            rel = f"images/test/f{i:03d}.jpg"
            make_jpeg(handle.folder / rel, 4000, 2667, seed=i, exif=AERIA_EXIF)
            img = Image(path=rel, width=4000, height=2667, source_id=source.id, alt=191.0)
            s.add(img)
            s.flush()
            s.add(DatasetImage(dataset_id=dataset.id, image_id=img.id, split="train"))
            s.add(
                Box(
                    image_id=img.id,
                    class_id="c1",
                    x=1800,
                    y=1200,
                    w=132,
                    h=110,
                    provenance_kind="person",
                )
            )
            s.add(
                Box(
                    image_id=img.id,
                    class_id="c2",
                    x=2200,
                    y=1300,
                    w=157,
                    h=120,
                    provenance_kind="person",
                )
            )
        model = Model(
            name="ICVD_V4",
            kind="trained",
            weights_path="models/icvd-v4.pt",
            dataset_id=dataset.id,
            hyperparameters={"imgsz": 1280, "epochs": 50},
            class_names=["excavator", "dump_truck"],
        )
        s.add(model)
        s.flush()
        model_id = model.id
    return model_id


def test_gsd_estimate_endpoint_returns_the_scale_and_its_evidence(
    client, project_id, trained_model_with_dataset
):
    model_id = trained_model_with_dataset
    r = client.get(f"{BASE}/{project_id}/models/{model_id}/gsd-estimate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sensor_source"] == "focal_plane"
    assert body["focal_mm"] == pytest.approx(18.5, abs=0.01)
    assert body["sensor_width_mm"] == pytest.approx(23.456, abs=0.05)
    assert body["train_gsd_cm"] == pytest.approx(18.92, rel=0.02)
    assert body["sample_size"] <= 8
    assert body["plausible"] is True


def test_gsd_estimate_is_404_for_a_model_with_no_dataset(client, project_id, imported_model):
    r = client.get(f"{BASE}/{project_id}/models/{imported_model}/gsd-estimate")
    assert r.status_code == 404


def test_patch_stores_the_scale_and_it_comes_back_on_the_model(
    client, project_id, trained_model_with_dataset
):
    model_id = trained_model_with_dataset
    r = client.patch(f"{BASE}/{project_id}/models/{model_id}", json={"train_gsd_cm": 18.92})
    assert r.status_code == 200, r.text
    assert r.json()["train_gsd_cm"] == pytest.approx(18.92)
    assert client.get(f"{BASE}/{project_id}/models/{model_id}").json()["train_gsd_cm"] == pytest.approx(18.92)


def test_patch_rejects_a_non_positive_scale(client, project_id, trained_model_with_dataset):
    r = client.patch(f"{BASE}/{project_id}/models/{trained_model_with_dataset}", json={"train_gsd_cm": 0})
    assert r.status_code == 422
