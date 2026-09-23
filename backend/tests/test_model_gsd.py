"""The scale a model was trained at (spec 2026-09-23-model-training-gsd-design section 2-3).

The numbers are the real senseFly Aeria X frames behind ICVD_V3: focal 18.5 mm, a 23.456 mm
sensor read off FocalPlaneXResolution, flown at a median 191.02 m, letterboxed to imgsz 1280.
"""

import pytest
from sqlalchemy import select

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


def test_orientation_cancels_out_end_to_end():
    """A portrait-stored frame must give the same model GSD as the landscape one.

    `prepare.py` applies `ImageOps.exif_transpose`, so a frame shot at orientation 6/8 is *stored*
    portrait while the EXIF travelling with it still reports the sensor's long axis -- so
    `sensor_width_mm`, and the ground width it implies, always describe the long side. Driving
    `image_gsd_cm` -> `model_gsd_cm` (rather than handing `model_gsd_cm` a hard-coded image GSD, as
    the test above does) is what makes the cancellation observable: with a stored *width* divisor
    the portrait case came out 4000/2667 = 1.5x too large, which would push section 3.3's 8.5 m
    median to 12.8 m -- still inside the plausible band, so it would be offered as a silent default.
    """
    landscape = image_gsd_cm(191.02175, AERIA_X, max(4000, 2667))
    portrait = image_gsd_cm(191.02175, AERIA_X, max(2667, 4000))
    assert model_gsd_cm(landscape, 4000, 2667, 1280) == pytest.approx(18.92, abs=0.02)
    assert model_gsd_cm(portrait, 2667, 4000, 1280) == pytest.approx(18.92, abs=0.02)
    # Section 2's identity, in both orientations: the ground width divided by imgsz, with the
    # stored pixel count cancelling out entirely.
    ground_width_cm = 191.02175 * 100.0 * AERIA_X.sensor_width_mm / AERIA_X.focal_mm
    assert model_gsd_cm(portrait, 2667, 4000, 1280) == pytest.approx(ground_width_cm / 1280)


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

    The boxes are `review_state="accepted"`, which is how `datasets/boxes.py` creates a person-drawn
    box. The model default is `"unreviewed"`, i.e. a suggestion nobody has looked at, and those are
    not part of the training set the cross-check is supposed to measure.
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
                    review_state="accepted",
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
                    review_state="accepted",
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
    # Pins the arithmetic (Box.w, not Box.h -- the fixture's h values of 110/120 px would compute
    # to ~6.66/~7.27 m instead, still inside the plausible band but nowhere near these numbers)
    # and the name-keying of per_class_m (a class-id key would not match "excavator"/"dump_truck").
    assert body["per_class_m"] == pytest.approx({"excavator": 7.99, "dump_truck": 9.5}, abs=0.05)
    assert body["median_object_m"] == pytest.approx(8.75, abs=0.05)


@pytest.fixture
def portrait_model(handle, make_jpeg, tmp_path):
    """The same camera, but frames *stored* portrait — `prepare.py`'s `exif_transpose` of a frame
    shot at orientation 6/8. The EXIF still reports the 6000 px long axis, as a real file does."""
    from app.db.models import Box, Dataset, DatasetImage, Image, Model, Source

    with handle.session() as s:
        source = Source(folder=str(tmp_path / "p"), site="portrait", image_count=2)
        s.add(source)
        s.flush()
        dataset = Dataset(
            name="ICVD_V3_portrait",
            classes=[{"id": "c1", "name": "excavator"}],
            split_method="by_group",
            path="datasets/icvd_v3_p",
        )
        s.add(dataset)
        s.flush()
        for i in range(2):
            rel = f"images/portrait/p{i:03d}.jpg"
            make_jpeg(handle.folder / rel, 2667, 4000, seed=100 + i, exif=AERIA_EXIF)
            img = Image(path=rel, width=2667, height=4000, source_id=source.id, alt=191.0)
            s.add(img)
            s.flush()
            s.add(DatasetImage(dataset_id=dataset.id, image_id=img.id, split="train"))
            s.add(
                Box(
                    image_id=img.id,
                    class_id="c1",
                    x=100,
                    y=100,
                    w=132,
                    h=110,
                    provenance_kind="person",
                    review_state="accepted",
                )
            )
        model = Model(
            name="ICVD_V4_portrait",
            kind="trained",
            weights_path="models/icvd-v4-p.pt",
            dataset_id=dataset.id,
            hyperparameters={"imgsz": 1280},
            class_names=["excavator"],
        )
        s.add(model)
        s.flush()
        return model.id


def test_a_portrait_stored_frame_gives_the_same_scale(client, project_id, portrait_model):
    # Dividing the ground width by the stored *width* (2667) and then letterboxing by the long side
    # (4000) does not cancel: it returned 28.4 cm/px, 1.5x too large, and dragged the cross-check's
    # 8 m machines to 12 m — still inside the plausible band, so it would be offered silently.
    body = client.get(f"{BASE}/{project_id}/models/{portrait_model}/gsd-estimate").json()
    assert body["train_gsd_cm"] == pytest.approx(18.92, rel=0.02)
    assert body["image_gsd_cm"] == pytest.approx(6.055, abs=0.01)
    assert body["per_class_m"]["excavator"] == pytest.approx(7.99, abs=0.05)


def test_the_cross_check_ignores_unreviewed_suggestions_and_deleted_classes(
    client, project_id, handle, trained_model_with_dataset
):
    """The evidence must be computed over the training set, not over everything in the table.

    On a project where suggestions were generated before curation, an unreviewed box is exactly
    what the curator rejected; a box whose class was deleted is one `materialise.py` skips. Either
    one drags `per_class_m` and the median the plausibility gate reads.
    """
    from app.db.models import Box, DatasetImage

    model_id = trained_model_with_dataset
    before = client.get(f"{BASE}/{project_id}/models/{model_id}/gsd-estimate").json()

    with handle.session() as s:
        image_id = s.execute(select(DatasetImage.image_id)).scalars().first()
        # A rejected suggestion 1000 px across: ~60 m, which would nearly double the excavator
        # average and shove the median out of the 2-25 m band.
        s.add(Box(image_id=image_id, class_id="c1", x=0, y=0, w=1000, h=900, provenance_kind="model"))
        # Accepted, but its class was deleted from the dataset: it was never trained on, and it
        # would appear in per_class_m keyed by a raw id nobody can read.
        s.add(
            Box(
                image_id=image_id,
                class_id="c9",
                x=0,
                y=0,
                w=1000,
                h=900,
                provenance_kind="person",
                review_state="accepted",
            )
        )

    after = client.get(f"{BASE}/{project_id}/models/{model_id}/gsd-estimate").json()
    assert after["per_class_m"] == before["per_class_m"]
    assert after["median_object_m"] == before["median_object_m"]
    assert after["plausible"] is True
    assert "c9" not in after["per_class_m"]


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
