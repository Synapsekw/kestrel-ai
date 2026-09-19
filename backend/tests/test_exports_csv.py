"""Rows loading and the CSV writer (G2, plan Task 1)."""

import csv
from datetime import UTC, datetime

import pytest

from app.db.models import Box, Image, Source
from app.exports import csv_out, rows

CLASSES = ["excavator", "dump_truck"]


@pytest.fixture
def project_id(client, project_dir) -> str:
    """Two classes only: the default `project` fixture's eight classes would leak into count tables."""
    body = {
        "name": "T",
        "folder": str(project_dir),
        "classes": [{"name": n, "colour": c} for n, c in zip(CLASSES, ["#ff0000", "#00ff00"], strict=True)],
    }
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def handle(app, project_id):
    return app.state.projects.get(project_id)


@pytest.fixture
def two_images(handle, project_dir):
    """Two images (one with GPS + capture time), a box of each origin, and one rejected box."""
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        img0 = Image(
            path="images/a.jpg",
            width=2000,
            height=1000,
            source_id=source.id,
            capture_time=datetime(2026, 9, 18, 12, 0, 0, tzinfo=UTC),
            lat=37.7749,
            lon=-122.4194,
            group_key="flight_1",
        )
        img1 = Image(
            path="images/b.jpg",
            width=1000,
            height=1000,
            source_id=source.id,
            group_key="flight_1",
            marked_empty=True,
        )
        s.add_all([img0, img1])
        s.flush()
        class_ids = {c["name"]: c["id"] for c in handle.row(s).classes}
        t0 = datetime(2026, 9, 18, 13, 0, 0, tzinfo=UTC)
        boxes = [
            Box(
                image_id=img0.id,
                class_id=class_ids["excavator"],
                x=100,
                y=200,
                w=50,
                h=60,
                provenance_kind="person",
                review_state="accepted",
                created_at=t0,
            ),
            Box(
                image_id=img0.id,
                class_id=class_ids["dump_truck"],
                x=300,
                y=100,
                w=80,
                h=40,
                confidence=0.8,
                provenance_kind="local_model",
                model_name="v1-yolo",
                review_state="edited",
                created_at=t0.replace(second=1),
            ),
            Box(
                image_id=img0.id,
                class_id=class_ids["excavator"],
                x=10,
                y=10,
                w=20,
                h=20,
                confidence=0.55,
                provenance_kind="cloud_provider",
                provider="anthropic",
                model_name="claude-x",
                review_state="unreviewed",
                created_at=t0.replace(second=2),
            ),
            Box(
                image_id=img0.id,
                class_id=class_ids["dump_truck"],
                x=5,
                y=5,
                w=5,
                h=5,
                created_at=t0.replace(second=3),
                provenance_kind="person",
                review_state="rejected",
            ),
        ]
        s.add_all(boxes)
    return {"image0": img0.id, "image1": img1.id}


def _read(path):
    return path.read_bytes().decode("utf-8-sig")


def test_load_default_excludes_unreviewed_and_rejected(handle, two_images):
    images, classes = rows.load(handle)
    assert [c["name"] for c in classes] == CLASSES
    assert [i.path for i in images] == ["images/a.jpg", "images/b.jpg"]
    a, b = images
    assert {bx.review_state for bx in a.boxes} == {"accepted", "edited"}
    assert b.boxes == []
    assert b.marked_empty is True


def test_load_with_include_unreviewed_adds_the_proposal_never_the_rejected(handle, two_images):
    images, _ = rows.load(handle, include_unreviewed=True)
    a = images[0]
    assert {bx.review_state for bx in a.boxes} == {"accepted", "edited", "unreviewed"}


def test_detections_csv_exact_text(handle, two_images, tmp_path):
    images, classes = rows.load(handle)
    folder = tmp_path / "out"
    files = csv_out.write(images, classes, folder)
    assert files == ["detections.csv", "counts_by_group.csv", "counts_by_image.csv"]
    text = _read(folder / "detections.csv")
    lines = text.split("\r\n")
    assert lines[0] == (
        "image,source,group,capture_time,image_lat,image_lon,class,x,y,w,h,confidence,"
        "origin,origin_name,review_state,box_id"
    )
    # Only the person (accepted) and local_model (edited) boxes of image a; rejected is never present.
    body = [line for line in lines[1:] if line]
    assert len(body) == 2
    prefix = "images/a.jpg,siteA,flight_1,2026-09-18T12:00:00Z,37.7749,-122.4194,"
    person_id = next(b.id for b in images[0].boxes if b.origin == "person")
    assert body[0] == f"{prefix}excavator,100.0,200.0,50.0,60.0,,person,,accepted,{person_id}"
    assert body[1].startswith(f"{prefix}dump_truck,")
    assert ",0.8,local_model,v1-yolo,edited," in body[1]


def test_detections_csv_with_include_unreviewed_adds_the_cloud_row(handle, two_images, tmp_path):
    images, classes = rows.load(handle, include_unreviewed=True)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)
    text = _read(folder / "detections.csv")
    body = [line for line in text.split("\r\n")[1:] if line]
    assert len(body) == 3
    cloud_row = next(line for line in body if "cloud_provider" in line)
    assert ",0.55,cloud_provider,anthropic/claude-x,unreviewed," in cloud_row
    assert not any("rejected" in line for line in body)


def test_counts_by_group_has_one_row_with_both_classes_and_the_zero_image(handle, two_images, tmp_path):
    images, classes = rows.load(handle)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)
    text = _read(folder / "counts_by_group.csv")
    lines = [line for line in text.split("\r\n") if line]
    assert lines[0] == "group,images,excavator,dump_truck,unreviewed,total"
    assert lines[1] == "flight_1,2,1,1,0,2"


def test_counts_by_group_unreviewed_column_counts_them_while_classes_keep_counting_everything(
    handle, two_images, tmp_path
):
    images, classes = rows.load(handle, include_unreviewed=True)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)
    text = _read(folder / "counts_by_group.csv")
    lines = [line for line in text.split("\r\n") if line]
    # 2 excavator (accepted + the unreviewed cloud one), 1 dump_truck, 1 of the 3 is unreviewed.
    assert lines[1] == "flight_1,2,2,1,1,3"


def test_counts_by_image_includes_the_zero_box_image_with_marked_empty(handle, two_images, tmp_path):
    images, classes = rows.load(handle)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)
    text = _read(folder / "counts_by_image.csv")
    lines = [line for line in text.split("\r\n") if line]
    assert lines[0] == (
        "image,group,capture_time,image_lat,image_lon,marked_empty,excavator,dump_truck,unreviewed,total"
    )
    assert lines[1] == "images/a.jpg,flight_1,2026-09-18T12:00:00Z,37.7749,-122.4194,false,1,1,0,2"
    assert lines[2] == "images/b.jpg,flight_1,,,,true,0,0,0,0"


def test_counts_by_image_unreviewed_column_with_include_unreviewed(handle, two_images, tmp_path):
    images, classes = rows.load(handle, include_unreviewed=True)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)
    text = _read(folder / "counts_by_image.csv")
    lines = [line for line in text.split("\r\n") if line]
    assert lines[1] == "images/a.jpg,flight_1,2026-09-18T12:00:00Z,37.7749,-122.4194,false,2,1,1,3"


def test_image_ids_filters_the_selection(handle, two_images):
    images, _ = rows.load(handle, image_ids=[two_images["image1"]])
    assert [i.path for i in images] == ["images/b.jpg"]


def test_text_helper_prefixes_a_formula_looking_value_leaves_others_alone():
    assert csv_out._text("=1+1") == "'=1+1"
    assert csv_out._text("+1") == "'+1"
    assert csv_out._text("-1") == "'-1"
    assert csv_out._text("@cmd") == "'@cmd"
    assert csv_out._text("\t=1") == "'\t=1"
    assert csv_out._text("excavator") == "excavator"
    assert csv_out._text("") == ""


def test_formula_injection_is_neutralised_in_text_columns_only(handle, project_dir, tmp_path):
    """A class named `=1+1` and a site (file name) starting with `-` must never execute as a formula."""
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="-evil")
        s.add(source)
        s.flush()
        img = Image(path="images/a.jpg", width=100, height=100, source_id=source.id, group_key="-flight")
        s.add(img)
        s.flush()
        project = handle.row(s)
        classes = list(project.classes)
        classes[0] = {**classes[0], "name": "=1+1"}
        project.classes = classes
        s.add(project)
        s.flush()
        class_id = classes[0]["id"]
        s.add(
            Box(
                image_id=img.id,
                class_id=class_id,
                x=1,
                y=1,
                w=10,
                h=10,
                provenance_kind="person",
                review_state="accepted",
            )
        )
    images, classes = rows.load(handle)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)

    detections = _read(folder / "detections.csv")
    assert ",'=1+1," in detections  # the class column
    assert ",'-evil," in detections  # the source column
    assert ",'-flight," in detections  # the group column
    assert "images/a.jpg" in detections  # a path starting with "images/" is left alone

    by_group = _read(folder / "counts_by_group.csv")
    assert "'-flight" in by_group  # the group column
    assert "'=1+1" in by_group  # the class column, now a header

    by_image = _read(folder / "counts_by_image.csv")
    assert "'=1+1" in by_image
    assert "'-flight" in by_image


def test_a_class_name_with_a_comma_and_a_quote_round_trips_through_csv_quoting(
    handle, project_dir, tmp_path
):
    """csv.writer's own quoting must survive a class name that itself looks like it could break a row."""
    tricky = 'Wheel, "Loader"'
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="siteA")
        s.add(source)
        s.flush()
        img = Image(path="images/a.jpg", width=100, height=100, source_id=source.id, group_key="g1")
        s.add(img)
        s.flush()
        project = handle.row(s)
        classes = list(project.classes)
        classes[0] = {**classes[0], "name": tricky}
        project.classes = classes
        s.add(project)
        s.flush()
        s.add(
            Box(
                image_id=img.id,
                class_id=classes[0]["id"],
                x=1,
                y=1,
                w=10,
                h=10,
                provenance_kind="person",
                review_state="accepted",
            )
        )
    images, classes = rows.load(handle)
    folder = tmp_path / "out"
    csv_out.write(images, classes, folder)

    with open(folder / "detections.csv", encoding="utf-8-sig", newline="") as f:
        rows_read = list(csv.reader(f))
    class_col = rows_read[0].index("class")
    assert rows_read[1][class_col] == tricky

    with open(folder / "counts_by_group.csv", encoding="utf-8-sig", newline="") as f:
        header = next(csv.reader(f))
    assert tricky in header
