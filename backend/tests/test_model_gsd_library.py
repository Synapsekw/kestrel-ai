"""The scale a model was trained at, derived from a library dataset built across projects
(spec 2026-09-23 section 3, ported by foundation F §12.2 step 4; plan BM Task 9). Same real
senseFly Aeria X numbers as test_model_gsd.py: the answer must not change because the frames now
come from two projects."""

import pytest
from catalogue_fake import catalogue  # noqa: F401 - fixture
from library_datasets_helpers import (
    LIB,
    add_box,
    add_image,
    add_source,
    build_dataset,
    create_body,
    make_project,
)
from library_helpers import add_library_model
from test_model_gsd import AERIA_EXIF, _dataset_of_frames

from app.datasets.materialise import data_yaml
from app.library import service
from app.library.datasets.legacy import register_legacy_dataset


@pytest.fixture
def frames_in_two_projects(client, app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    """Three 4000x2667 Aeria X frames per project at 191 m, one excavator (132 px wide) and one
    dump truck (157 px) on each: the ICVD_V3 geometry of test_model_gsd.py."""
    exc = catalogue.add("excavator", type_id="c1")
    truck = catalogue.add("dump_truck", type_id="c2")
    projects = []
    for folder in ("a", "b"):
        handle = make_project(app, tmp_path / folder, folder.upper())
        src = add_source(handle)
        for i in range(3):
            image_id = add_image(
                handle, make_jpeg, src, f"f{i}.jpg", w=4000, h=2667, alt=191.0, exif=AERIA_EXIF, seed=i
            )
            add_box(handle, image_id, exc.id, x=100, y=100, w=132, h=110)
            add_box(handle, image_id, truck.id, x=400, y=100, w=157, h=120)
        projects.append(handle)
    d = build_dataset(client, create_body("icvd", [p.id for p in projects], [exc.id, truck.id]))
    return projects, d["id"]


def test_the_scale_of_a_dataset_built_across_projects(app, frames_in_two_projects):
    _, dataset_id = frames_in_two_projects
    estimate = service.estimate_for_library_dataset(app.state.library, app.state.projects, dataset_id, 1280)
    assert estimate is not None
    assert estimate.train_gsd_cm == pytest.approx(18.92, rel=0.02)
    assert estimate.per_class_m == pytest.approx({"excavator": 7.99, "dump_truck": 9.5}, abs=0.05)
    assert estimate.plausible is True
    assert 1 <= estimate.sample_size <= 8


def test_the_endpoint_measures_a_model_trained_on_a_library_dataset(
    client, app, tmp_path, frames_in_two_projects
):
    _, dataset_id = frames_in_two_projects
    model = add_library_model(
        app,
        tmp_path,
        origin="trained",
        hyperparameters={"imgsz": 1280},
        provenance={"dataset_id": dataset_id},
    )
    r = client.get(f"{LIB}/models/{model.id}/gsd-estimate")
    assert r.status_code == 200, r.text
    assert r.json()["train_gsd_cm"] == pytest.approx(18.92, rel=0.02)


def test_a_project_that_went_missing_leaves_the_estimate_to_the_other(app, frames_in_two_projects):
    (a, b), dataset_id = frames_in_two_projects
    app.state.projects.forget(b.id)
    b.folder.rename(b.folder.with_name("b-moved"))
    estimate = service.estimate_for_library_dataset(app.state.library, app.state.projects, dataset_id, 1280)
    assert estimate is not None and estimate.train_gsd_cm == pytest.approx(18.92, rel=0.02)


def test_a_legacy_dataset_is_measured_in_its_project_as_before(client, app, tmp_path, make_jpeg):
    """A legacy dataset has no items: the estimate must delegate to the project's own derivation.

    Depends on `client` (unused otherwise) to force the app's lifespan to start, which is what
    opens `app.state.projects`; `make_project` needs it and runs before the test body."""
    handle = make_project(app, tmp_path / "old", "Old")
    classes = [{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}]
    project_dataset = _dataset_of_frames(
        handle,
        make_jpeg,
        tmp_path,
        name="ICVD_V3",
        w=4000,
        h=2667,
        site="test",
        count=3,
        classes=classes,
        boxes=[("c1", 132, 110), ("c2", 157, 120)],
    )
    folder = handle.folder / "datasets" / "icvd_v3"  # the path `_dataset_of_frames` records
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "data.yaml").write_text(data_yaml(folder, ["excavator", "dump_truck"]), "utf-8")
    dataset_id = register_legacy_dataset(app.state.library, handle, project_dataset)

    via_library = service.estimate_for_library_dataset(
        app.state.library, app.state.projects, dataset_id, 1280
    )

    assert via_library is not None
    assert via_library == service.estimate_for_dataset(handle, project_dataset, 1280)
    assert via_library.train_gsd_cm == pytest.approx(18.92, rel=0.02)


def test_a_legacy_dataset_without_a_legacy_dataset_id_falls_back_to_the_matching_project_dataset(
    client, app, tmp_path, make_jpeg
):
    """Amendment A12: the migration unit MG may write a legacy dataset row without
    `legacy_dataset_id`. The estimate must still find the project's own dataset by resolved path.

    Depends on `client` (unused otherwise) to force the app's lifespan to start; see the note on
    `test_a_legacy_dataset_is_measured_in_its_project_as_before`."""
    from app.library.db import LibraryDataset

    handle = make_project(app, tmp_path / "old2", "Old2")
    classes = [{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}]
    project_dataset = _dataset_of_frames(
        handle,
        make_jpeg,
        tmp_path,
        name="ICVD_V3",
        w=4000,
        h=2667,
        site="test",
        count=3,
        classes=classes,
        boxes=[("c1", 132, 110), ("c2", 157, 120)],
    )
    folder = handle.folder / "datasets" / "icvd_v3"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "data.yaml").write_text(data_yaml(folder, ["excavator", "dump_truck"]), "utf-8")
    library_dataset_id = register_legacy_dataset(app.state.library, handle, project_dataset)
    # Simulate MG writing the row without `legacy_dataset_id`.
    with app.state.library.session() as s:
        row = s.get(LibraryDataset, library_dataset_id)
        row.legacy_dataset_id = None

    via_library = service.estimate_for_library_dataset(
        app.state.library, app.state.projects, library_dataset_id, 1280
    )

    assert via_library is not None
    assert via_library == service.estimate_for_dataset(handle, project_dataset, 1280)
    assert via_library.train_gsd_cm == pytest.approx(18.92, rel=0.02)


def test_an_unknown_dataset_or_size_yields_nothing(client, app):
    assert service.estimate_for_library_dataset(app.state.library, app.state.projects, "nope", 1280) is None
    assert service.estimate_for_library_dataset(app.state.library, app.state.projects, "nope", 0) is None
