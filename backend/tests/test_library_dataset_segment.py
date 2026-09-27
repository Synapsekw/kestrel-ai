"""Segment datasets: shapes in frozen labels, inclusion by task, skipped counts (image spec §11.1,
I-D10; plan I-BT Task 3)."""

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
from library_helpers import wait_library_job

from app.library.db import LibraryDatasetItem

TRI = [[20.0, 10.0], [80.0, 20.0], [50.0, 60.0]]


def _poly(handle, image_id, type_id, points=TRI):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return add_box(
        handle,
        image_id,
        type_id,
        shape="polygon",
        points=points,
        x=min(xs),
        y=min(ys),
        w=max(xs) - min(xs),
        h=max(ys) - min(ys),
        area_px=1500.0,
    )


@pytest.fixture
def mixed(app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    """One project: img1 a crack polygon, img2 a crack box, img3 a polygon plus a crack point,
    img4 marked empty."""
    crack = catalogue.add("Crack")
    p = make_project(app, tmp_path / "p", "Bridge")
    src = add_source(p)
    ids = [
        add_image(
            p,
            make_jpeg,
            src,
            f"DJI_000{i}.jpg",
            w=100,
            h=80,
            group_key=f"g{i}",
            seed=i,
            marked_empty=(i == 4),
        )
        for i in (1, 2, 3, 4)
    ]
    _poly(p, ids[0], crack.id)
    add_box(p, ids[1], crack.id, x=10, y=10, w=30, h=20)
    _poly(p, ids[2], crack.id)
    add_box(p, ids[2], crack.id, shape="point", x=40, y=40, w=0, h=0)
    return p, crack, ids


def _items(app, dataset_id):
    with app.state.library.session() as s:
        return {
            i.image_id: i.labels
            for i in s.query(LibraryDatasetItem).filter(LibraryDatasetItem.dataset_id == dataset_id)
        }


def _build(client, body) -> tuple[dict, dict]:
    """The finished dataset and its `dataset_build` job result (which carries `skipped`)."""
    r = client.post(f"{LIB}/datasets", json=body)
    assert r.status_code == 202, r.text
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "succeeded", done["error"]
    return client.get(f"{LIB}/datasets/{r.json()['dataset']['id']}").json(), done["result"]


def test_preview_counts_the_images_a_task_skips(client, mixed):
    p, crack, _ = mixed
    body = {"project_ids": [p.id], "type_ids": [crack.id], "reviewed_only": False}
    # the point image in every task; the box image too in segment
    for task, expected in (("detect", 1), ("obb", 1), ("segment", 2)):
        r = client.post(f"{LIB}/datasets/preview", params={"task": task}, json=body)
        assert r.status_code == 200, r.text
        assert r.json()["images"] == 4 and r.json()["skipped_by_task"] == expected
    r = client.post(
        f"{LIB}/datasets/preview", params={"task": "segment"}, json={**body, "boxes_as_polygons": True}
    )
    assert r.json()["skipped_by_task"] == 1
    assert (
        client.post(f"{LIB}/datasets/preview", json=body).json()["skipped_by_task"] == 1
    )  # detect when absent


def test_segment_build_skips_box_images_and_counts_them(client, app, mixed):
    p, crack, ids = mixed
    d, result = _build(client, create_body("cracks", [p.id], [crack.id], task="segment"))
    assert result["skipped"] == 2
    items = _items(app, d["id"])
    assert set(items) == {ids[0], ids[3]}  # the polygon image and the negative
    [label] = items[ids[0]]
    assert label["shape"] == "polygon" and label["points"] == TRI
    assert items[ids[3]] == []


def test_boxes_as_polygons_lets_box_images_in(client, app, mixed):
    p, crack, ids = mixed
    body = create_body("cracks", [p.id], [crack.id], task="segment")
    body["filter"]["boxes_as_polygons"] = True
    d, result = _build(client, body)
    assert result["skipped"] == 1
    assert d["filter"]["boxes_as_polygons"] is True
    items = _items(app, d["id"])
    assert set(items) == {ids[0], ids[1], ids[3]}
    assert items[ids[1]][0]["shape"] == "box" and "points" not in items[ids[1]][0]


def test_a_point_skips_its_image_in_every_task(client, app, mixed):
    p, crack, ids = mixed
    for task in ("detect", "obb"):
        d, result = _build(client, create_body(f"c-{task}", [p.id], [crack.id], task=task))
        assert result["skipped"] == 1
        assert ids[2] not in _items(app, d["id"])


def test_a_build_where_everything_is_skipped_says_why(client, app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    exc = catalogue.add("Excavator")
    p = make_project(app, tmp_path / "boxes", "Boxes")
    src = add_source(p)
    add_box(p, add_image(p, make_jpeg, src, "a.jpg"), exc.id)
    r = client.post(f"{LIB}/datasets", json=create_body("seg", [p.id], [exc.id], task="segment"))
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "failed"
    assert "1 matching images were skipped" in done["error"]
    assert "Boxes as polygons" in done["error"]


def test_a_detect_dataset_freezes_boxes_with_their_shape(client, app, mixed):
    p, crack, ids = mixed
    d = build_dataset(client, create_body("det", [p.id], [crack.id]))
    label = _items(app, d["id"])[ids[1]][0]
    assert {k: label[k] for k in ("type_id", "x", "y", "w", "h", "angle", "shape")} == {
        "type_id": crack.id,
        "x": 10,
        "y": 10,
        "w": 30,
        "h": 20,
        "angle": 0.0,
        "shape": "box",
    }
