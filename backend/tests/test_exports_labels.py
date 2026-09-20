"""YOLO and COCO label writers (G2, plan Task 2)."""

import json

import pytest

from app.exports import coco_out, yolo_out
from app.exports.rows import ExportBox, ExportImage
from app.jobs.cancellation import JobFailure

CLASSES = [{"id": "c-exc", "name": "excavator"}, {"id": "c-dt", "name": "dump_truck"}]


def _box(**over) -> ExportBox:
    base = dict(
        id="b1",
        class_id="c-exc",
        class_name="excavator",
        x=0,
        y=0,
        w=10,
        h=10,
        angle=0,
        confidence=None,
        origin="person",
        origin_name="",
        review_state="accepted",
    )
    base.update(over)
    return ExportBox(**base)


def _image(**over) -> ExportImage:
    base = dict(
        id="i1",
        path="images/a.jpg",
        source_site="siteA",
        group="flight_1",
        capture_time=None,
        lat=None,
        lon=None,
        width=4000,
        height=3000,
        marked_empty=False,
        boxes=[],
    )
    base.update(over)
    return ExportImage(**base)


def test_yolo_label_text_for_a_known_box(tmp_path):
    images = [_image(path="images/siteA/a.jpg", boxes=[_box(class_id="c-exc", x=1000, y=600, w=400, h=300)])]
    files = yolo_out.write(images, CLASSES, tmp_path)
    assert files == ["labels_yolo", "labels_yolo/classes.txt"]
    text = (tmp_path / "labels_yolo" / "siteA" / "a.txt").read_text("utf-8")
    assert text == "0 0.300000 0.250000 0.100000 0.100000\n"


def test_yolo_empty_file_for_an_image_without_boxes(tmp_path):
    images = [_image(path="images/siteA/b.jpg", boxes=[])]
    yolo_out.write(images, CLASSES, tmp_path)
    text = (tmp_path / "labels_yolo" / "siteA" / "b.txt").read_text("utf-8")
    assert text == ""


def test_yolo_classes_txt(tmp_path):
    images = [_image(boxes=[])]
    files = yolo_out.write(images, CLASSES, tmp_path)
    assert files == ["labels_yolo", "labels_yolo/classes.txt"]
    text = (tmp_path / "labels_yolo" / "classes.txt").read_text("utf-8")
    assert text == "excavator\ndump_truck\n"


def test_yolo_second_class_index(tmp_path):
    images = [
        _image(
            path="images/siteA/a.jpg",
            boxes=[_box(class_id="c-dt", class_name="dump_truck", x=0, y=0, w=100, h=100)],
        )
    ]
    yolo_out.write(images, CLASSES, tmp_path)
    text = (tmp_path / "labels_yolo" / "siteA" / "a.txt").read_text("utf-8")
    assert text.startswith("1 ")


def test_yolo_mirrors_the_site_so_same_named_images_never_collide(tmp_path):
    """Two sources can each import a file called DJI_0001.jpg (see test_two_sources_can_share_a_site
    in test_import.py); the label tree must mirror that, not flatten it."""
    images = [
        _image(
            id="i1",
            path="images/siteA/DJI_0001.jpg",
            boxes=[_box(id="bA", class_id="c-exc", x=0, y=0, w=100, h=100)],
        ),
        _image(
            id="i2",
            path="images/siteB/DJI_0001.jpg",
            boxes=[_box(id="bB", class_id="c-dt", class_name="dump_truck", x=0, y=0, w=200, h=200)],
        ),
    ]
    yolo_out.write(images, CLASSES, tmp_path)
    a = (tmp_path / "labels_yolo" / "siteA" / "DJI_0001.txt").read_text("utf-8")
    b = (tmp_path / "labels_yolo" / "siteB" / "DJI_0001.txt").read_text("utf-8")
    # Both images default to 4000x3000 (see `_image`); box (0,0,100,100) and (0,0,200,200).
    assert a == "0 0.012500 0.016667 0.025000 0.033333\n"
    assert b == "1 0.025000 0.033333 0.050000 0.066667\n"


def test_yolo_refuses_two_images_with_the_same_stem_in_one_site(tmp_path):
    """`x.jpg` and `x.jpeg` in one site would both write labels_yolo/siteA/x.txt (M4, m3)."""
    images = [
        _image(id="i1", path="images/siteA/x.jpg", boxes=[]),
        _image(id="i2", path="images/siteA/x.jpeg", boxes=[]),
    ]
    with pytest.raises(JobFailure) as exc_info:
        yolo_out.write(images, CLASSES, tmp_path)
    assert str(exc_info.value) == (
        "x.jpg and x.jpeg in siteA would get the same YOLO label file. Export without YOLO "
        "labels, or delete one of the two images from the project."
    )
    assert not (tmp_path / "labels_yolo").exists()  # nothing written before the check ran


def test_yolo_collision_message_names_the_project_when_there_is_no_site_folder(tmp_path):
    images = [
        _image(id="i1", path="x.jpg", boxes=[]),
        _image(id="i2", path="x.jpeg", boxes=[]),
    ]
    with pytest.raises(JobFailure) as exc_info:
        yolo_out.write(images, CLASSES, tmp_path)
    assert "in the project would get the same YOLO label file" in str(exc_info.value)


def test_coco_structure(tmp_path):
    images = [
        _image(
            path="images/a.jpg",
            width=4000,
            height=3000,
            boxes=[_box(class_id="c-exc", x=100, y=200, w=50, h=60, confidence=0.9)],
        ),
        _image(path="images/b.jpg", width=1000, height=1000, boxes=[]),
    ]
    files = coco_out.write(images, CLASSES, tmp_path)
    assert files == ["labels_coco.json"]
    data = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))

    assert [(im["file_name"], im["width"], im["height"]) for im in data["images"]] == [
        ("images/a.jpg", 4000, 3000),
        ("images/b.jpg", 1000, 1000),
    ]
    ids = [im["id"] for im in data["images"]]
    assert len(set(ids)) == 2

    assert [c["id"] for c in data["categories"]] == [1, 2]
    assert [c["name"] for c in data["categories"]] == ["excavator", "dump_truck"]

    assert len(data["annotations"]) == 1
    ann = data["annotations"][0]
    assert ann["bbox"] == [100, 200, 50, 60]
    assert ann["area"] == 50 * 60
    assert ann["iscrowd"] == 0
    assert ann["category_id"] == 1
    assert ann["image_id"] == ids[0]
    assert ann["score"] == 0.9
    assert ann["review_state"] == "accepted"


def test_coco_no_score_when_confidence_is_none(tmp_path):
    images = [_image(boxes=[_box(confidence=None)])]
    coco_out.write(images, CLASSES, tmp_path)
    data = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))
    assert "score" not in data["annotations"][0]


def test_coco_carries_review_state_on_every_annotation(tmp_path):
    images = [
        _image(
            boxes=[
                _box(id="b1", review_state="accepted"),
                _box(id="b2", review_state="unreviewed", confidence=0.4),
            ]
        )
    ]
    coco_out.write(images, CLASSES, tmp_path)
    data = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))
    states = {a["id"]: a["review_state"] for a in data["annotations"]}
    assert states == {1: "accepted", 2: "unreviewed"}


def test_coco_category_ids_are_stable_across_calls(tmp_path):
    images = [_image(boxes=[])]
    coco_out.write(images, CLASSES, tmp_path / "run1")
    coco_out.write(images, CLASSES, tmp_path / "run2")
    d1 = json.loads((tmp_path / "run1" / "labels_coco.json").read_text("utf-8"))
    d2 = json.loads((tmp_path / "run2" / "labels_coco.json").read_text("utf-8"))
    assert d1["categories"] == d2["categories"]


def test_coco_bbox_is_the_envelope_and_segmentation_is_the_quad(tmp_path):
    """COCO has no rotated-box standard: `bbox` stays axis-aligned for every existing reader,
    and `segmentation` carries the exact rotated shape for anything that understands it.

    The angle is deliberately NOT 90 degrees. At a right angle the envelope is just the box with
    its sides swapped, so `bw * bh == w * h` and an `area` computed from the envelope would pass
    this test unnoticed. At 30 degrees the two diverge — 1200 against 2932 — so the assertion
    can actually fail.
    """
    images = [_image(boxes=[_box(x=10, y=20, w=60, h=20, angle=30)])]
    coco_out.write(images, CLASSES, tmp_path)
    ann = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))["annotations"][0]
    assert ann["bbox"] == pytest.approx([9.019238, 6.339746, 61.961524, 47.320508], abs=1e-6)
    assert ann["area"] == pytest.approx(60 * 20)  # rotation does not change area
    assert len(ann["segmentation"]) == 1
    assert ann["segmentation"][0] == pytest.approx(
        [19.019238, 6.339746, 70.980762, 36.339746, 60.980762, 53.660254, 9.019238, 23.660254],
        abs=1e-6,
    )


def test_coco_leaves_an_unrotated_annotation_exactly_as_it_was(tmp_path):
    images = [_image(boxes=[_box(x=10, y=20, w=30, h=40)])]
    coco_out.write(images, CLASSES, tmp_path)
    ann = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))["annotations"][0]
    assert ann["bbox"] == [10.0, 20.0, 30.0, 40.0]
    assert "segmentation" not in ann


def test_yolo_results_export_writes_the_envelope_of_a_rotated_box(tmp_path):
    """Wave 1 keeps the 5-number detect format, so a rotated box exports as its envelope —
    a loose label that still contains the object, never the unrotated box, which would not."""
    images = [_image(width=100, height=100, boxes=[_box(x=10, y=20, w=30, h=40, angle=90)])]
    yolo_out.write(images, CLASSES, tmp_path)
    line = (tmp_path / "labels_yolo" / "a.txt").read_text("utf-8").strip()
    index, cx, cy, w, h = line.split()
    assert index == "0"
    assert float(cx) == pytest.approx(0.25)  # centre is unchanged by rotation
    assert float(cy) == pytest.approx(0.40)
    assert float(w) == pytest.approx(0.40)  # 40 wide after the turn, not 30
    assert float(h) == pytest.approx(0.30)
