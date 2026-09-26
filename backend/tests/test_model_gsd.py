"""The scale a model was trained at (spec 2026-09-23-model-training-gsd-design section 2-3).

The numbers are the real senseFly Aeria X frames behind ICVD_V3: focal 18.5 mm, a 23.456 mm
sensor read off FocalPlaneXResolution, flown at a median 191.02 m, letterboxed to imgsz 1280.
"""

import pytest
from sqlalchemy import select

from app.library.gsd import (
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


# ------------------------------------------------------------------ the library endpoint
#
# The library is app-wide, so the dataset the estimate measures lives in another database: the
# model's `provenance` snapshot names the originating project folder and dataset id, and the route
# opens that project the same way `/usage` does.

LIB = "/api/v1/library"
AERIA_EXIF = {
    "focal_mm": 18.5,
    "exif_width": 6000,
    "sensor_px_per_cm": 2558.0,
    "alt": 191.0,
    "lat": 29.0,
    "lon": 47.6,
}


def _dataset_of_frames(handle, make_jpeg, tmp_path, *, name, w, h, site, count, classes, boxes):
    """A dataset of `count` frames carrying real Aeria X lens EXIF, with `boxes` on each frame.

    Each box is `review_state="accepted"`, which is how `datasets/boxes.py` creates a person-drawn
    box. The model default is `"unreviewed"`, i.e. a suggestion nobody has looked at, and those are
    not part of the training set the cross-check is supposed to measure.
    """
    from app.db.models import Box, Dataset, DatasetImage, Image, Source

    with handle.session() as s:
        source = Source(folder=str(tmp_path / site), site=site, image_count=count)
        s.add(source)
        s.flush()
        dataset = Dataset(
            name=name, classes=classes, split_method="by_group", path=f"datasets/{name.lower()}"
        )
        s.add(dataset)
        s.flush()
        for i in range(count):
            rel = f"images/{site}/f{i:03d}.jpg"
            make_jpeg(handle.folder / rel, w, h, seed=i, exif=AERIA_EXIF)
            img = Image(path=rel, width=w, height=h, source_id=source.id, alt=191.0)
            s.add(img)
            s.flush()
            s.add(DatasetImage(dataset_id=dataset.id, image_id=img.id, split="train"))
            for class_id, bw, bh in boxes:
                s.add(
                    Box(
                        image_id=img.id,
                        class_id=class_id,
                        x=100,
                        y=100,
                        w=bw,
                        h=bh,
                        provenance_kind="person",
                        review_state="accepted",
                    )
                )
        return dataset.id


@pytest.fixture
def trained_model(app, handle, make_jpeg, tmp_path, project_id):
    """A library model whose provenance points at a 12-frame dataset in the test project.

    The boxes are sized (in stored-image pixels) so that at the dataset's ~6.055 cm/px image GSD
    they imply real objects of roughly 8 m and 9.5 m: both inside the plausible band, so
    `plausible` comes back True.
    """
    from library_helpers import add_library_model

    dataset_id = _dataset_of_frames(
        handle,
        make_jpeg,
        tmp_path,
        name="ICVD_V3",
        w=4000,
        h=2667,
        site="test",
        count=12,
        classes=[{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}],
        boxes=[("c1", 132, 110), ("c2", 157, 120)],
    )
    row = add_library_model(
        app,
        tmp_path,
        name="ICVD_V4",
        origin="trained",
        hyperparameters={"imgsz": 1280, "epochs": 50},
        provenance={
            "project_id": project_id,
            "project_folder": str(handle.folder),
            "dataset_id": dataset_id,
            "dataset_name": "ICVD_V3",
        },
    )
    return row.id, dataset_id


@pytest.fixture
def imported_model(app, tmp_path):
    """`yolo11m-coco`: no dataset, nothing to measure."""
    from library_helpers import add_library_model

    return add_library_model(app, tmp_path, name="yolo11m-coco").id


def test_gsd_estimate_returns_the_scale_and_its_evidence(client, trained_model):
    model_id, _ = trained_model
    r = client.get(f"{LIB}/models/{model_id}/gsd-estimate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sensor_source"] == "focal_plane"
    assert body["focal_mm"] == pytest.approx(18.5, abs=0.01)
    assert body["sensor_width_mm"] == pytest.approx(23.456, abs=0.05)
    assert body["train_gsd_cm"] == pytest.approx(18.92, rel=0.02)
    assert body["plausible"] is True
    # Pins the arithmetic (Box.w, not Box.h -- the fixture's h values of 110/120 px would compute
    # to ~6.66/~7.27 m instead, still inside the plausible band but nowhere near these numbers)
    # and the name-keying of per_class_m (a class-id key would not match "excavator"/"dump_truck").
    assert body["per_class_m"] == pytest.approx({"excavator": 7.99, "dump_truck": 9.5}, abs=0.05)
    assert body["median_object_m"] == pytest.approx(8.75, abs=0.05)


def test_the_exif_sample_is_capped(client, trained_model):
    """12 frames in the dataset, at most EXIF_SAMPLE headers opened."""
    from app.library.gsd import EXIF_SAMPLE

    model_id, _ = trained_model
    assert client.get(f"{LIB}/models/{model_id}/gsd-estimate").json()["sample_size"] <= EXIF_SAMPLE


@pytest.fixture
def portrait_model(app, handle, make_jpeg, tmp_path):
    """The same camera, but frames *stored* portrait - `prepare.py`'s `exif_transpose` of a frame
    shot at orientation 6/8. The EXIF still reports the 6000 px long axis, as a real file does."""
    from library_helpers import add_library_model

    dataset_id = _dataset_of_frames(
        handle,
        make_jpeg,
        tmp_path,
        name="ICVD_V3_portrait",
        w=2667,
        h=4000,
        site="portrait",
        count=2,
        classes=[{"id": "c1", "name": "excavator"}],
        boxes=[("c1", 132, 110)],
    )
    return add_library_model(
        app,
        tmp_path,
        name="ICVD_V4_portrait",
        origin="trained",
        hyperparameters={"imgsz": 1280},
        provenance={"project_folder": str(handle.folder), "dataset_id": dataset_id},
    ).id


def test_a_portrait_stored_frame_gives_the_same_scale(client, portrait_model):
    # Dividing the ground width by the stored *width* (2667) and then letterboxing by the long side
    # (4000) does not cancel: it returned 28.4 cm/px, 1.5x too large, and dragged the cross-check's
    # 8 m machines to 12 m - still inside the plausible band, so it would be offered silently.
    body = client.get(f"{LIB}/models/{portrait_model}/gsd-estimate").json()
    assert body["train_gsd_cm"] == pytest.approx(18.92, rel=0.02)
    assert body["image_gsd_cm"] == pytest.approx(6.055, abs=0.01)
    assert body["per_class_m"]["excavator"] == pytest.approx(7.99, abs=0.05)


def test_the_cross_check_ignores_unreviewed_suggestions_and_deleted_classes(client, handle, trained_model):
    """The evidence must be computed over the training set, not over everything in the table.

    On a project where suggestions were generated before curation, an unreviewed box is exactly
    what the curator rejected; a box whose class was deleted is one `materialise.py` skips. Either
    one drags `per_class_m` and the median the plausibility gate reads.
    """
    from app.db.models import Box, DatasetImage

    model_id, _ = trained_model
    before = client.get(f"{LIB}/models/{model_id}/gsd-estimate").json()

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

    after = client.get(f"{LIB}/models/{model_id}/gsd-estimate").json()
    assert after["per_class_m"] == before["per_class_m"]
    assert after["median_object_m"] == before["median_object_m"]
    assert after["plausible"] is True
    assert "c9" not in after["per_class_m"]


def test_gsd_estimate_is_404_for_a_model_with_no_dataset(client, imported_model):
    assert client.get(f"{LIB}/models/{imported_model}/gsd-estimate").status_code == 404


def test_gsd_estimate_is_404_when_the_project_folder_is_gone(client, app, tmp_path):
    """An app-wide library outlives the project it was trained in. No fallback is invented."""
    from library_helpers import add_library_model

    orphan = add_library_model(
        app,
        tmp_path,
        name="orphan",
        origin="trained",
        hyperparameters={"imgsz": 1280},
        provenance={"project_folder": str(tmp_path / "deleted"), "dataset_id": "d-gone"},
    )
    assert client.get(f"{LIB}/models/{orphan.id}/gsd-estimate").status_code == 404


def test_patch_stores_the_scale_and_it_comes_back_on_the_model(client, trained_model):
    model_id, _ = trained_model
    r = client.patch(f"{LIB}/models/{model_id}", json={"train_gsd_cm": 18.92})
    assert r.status_code == 200, r.text
    assert r.json()["train_gsd_cm"] == pytest.approx(18.92)
    assert client.get(f"{LIB}/models/{model_id}").json()["train_gsd_cm"] == pytest.approx(18.92)


def test_patch_rejects_a_non_positive_scale(client, trained_model):
    model_id, _ = trained_model
    assert client.patch(f"{LIB}/models/{model_id}", json={"train_gsd_cm": 0}).status_code == 422


def test_patch_leaves_the_scale_alone_when_the_field_is_absent(client, trained_model):
    model_id, _ = trained_model
    client.patch(f"{LIB}/models/{model_id}", json={"train_gsd_cm": 18.92})
    client.patch(f"{LIB}/models/{model_id}", json={"notes": "notes only"})
    assert client.get(f"{LIB}/models/{model_id}").json()["train_gsd_cm"] == pytest.approx(18.92)


def test_the_derivation_the_training_job_calls(app, handle, trained_model):
    """`training/jobs.py` derives the scale from the open project before registering the model, so
    it does not depend on provenance it has not written yet."""
    from app.library import service

    _, dataset_id = trained_model
    estimate = service.estimate_for_dataset(handle, dataset_id, 1280)
    assert estimate is not None
    assert estimate.train_gsd_cm == pytest.approx(18.92, rel=0.02)
    assert estimate.plausible is True


def test_an_unmeasurable_dataset_yields_no_estimate(handle):
    from app.library import service

    assert service.estimate_for_dataset(handle, "no-such-dataset", 1280) is None
