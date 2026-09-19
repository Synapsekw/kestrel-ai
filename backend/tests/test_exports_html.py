"""Self-contained HTML report (G2, plan Task 3)."""

from datetime import UTC, datetime

from PIL import Image as PILImage

from app.exports import html_out
from app.exports.rows import ExportBox, ExportImage

CLASSES = [{"id": "c-exc", "name": "excavator", "colour": "#ff0000"}]
SETTINGS = {"formats": ["csv", "html"], "include_unreviewed": False}
EXPORT_TIME = datetime(2026, 9, 19, 10, 15, 0, tzinfo=UTC)


def _box(**over) -> ExportBox:
    base = dict(
        id="b1",
        class_id="c-exc",
        class_name="excavator",
        x=10,
        y=10,
        w=20,
        h=20,
        confidence=0.9,
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
        width=200,
        height=200,
        marked_empty=False,
        boxes=[],
    )
    base.update(over)
    return ExportImage(**base)


def _write(images, tmp_path, **kw):
    files = html_out.write(
        images, CLASSES, tmp_path, project_name=kw.pop("project_name", "Site A"),
        export_time=kw.pop("export_time", EXPORT_TIME), settings=kw.pop("settings", SETTINGS), **kw
    )
    assert files == ["report.html"]
    return (tmp_path / "report.html").read_text("utf-8")


def test_project_name_is_escaped(tmp_path):
    text = _write([_image()], tmp_path, project_name="Site <b>A</b>")
    assert "<b>A</b>" not in text
    assert "Site &lt;b&gt;A&lt;/b&gt;" in text


def test_totals_per_class(tmp_path):
    images = [_image(boxes=[_box(), _box(id="b2")]), _image(path="images/b.jpg")]
    text = _write(images, tmp_path)
    assert "<td>excavator</td><td>2</td>" in text


def test_no_external_requests(tmp_path):
    text = _write([_image(boxes=[_box()])], tmp_path, thumbnail_fn=lambda i: b"fake-jpeg-bytes")
    assert "http://" not in text
    assert "https://" not in text


def test_one_base64_image_per_image_with_boxes(tmp_path):
    images = [_image(boxes=[_box()]), _image(path="images/b.jpg", boxes=[])]
    text = _write(images, tmp_path, thumbnail_fn=lambda i: b"fake-jpeg-bytes")
    assert text.count('<img src="data:image/jpeg;base64,') == 1


def test_more_than_300_images_with_boxes_are_capped(tmp_path):
    images = [_image(path=f"images/{i:04d}.jpg", boxes=[_box(id=f"b{i}")]) for i in range(301)]
    text = _write(images, tmp_path, thumbnail_fn=lambda i: None)
    assert text.count('<div class="card">') == 300
    assert "1 more image with machinery" in text
    assert "detections.csv" in text


def test_checked_and_machinery_totals(tmp_path):
    images = [
        _image(path="images/a.jpg", boxes=[_box()]),
        _image(path="images/b.jpg", marked_empty=True),
        _image(path="images/c.jpg"),  # never reviewed: not "checked"
    ]
    text = _write(images, tmp_path, thumbnail_fn=lambda i: None)
    assert "2 images checked, 1 with machinery." in text


def test_drawn_thumbnail_differs_from_the_undrawn_one(tmp_path, make_jpeg):
    path = tmp_path / "a.jpg"
    make_jpeg(path, 200, 200, seed=1)
    undrawn = PILImage.open(path).convert("RGB")
    box = _box(x=50, y=50, w=60, h=60)
    drawn_bytes = html_out.draw_thumbnail(path, [box], CLASSES)
    import io

    drawn = PILImage.open(io.BytesIO(drawn_bytes)).convert("RGB")
    assert drawn.size == undrawn.size
    # The box's top edge, well inside the drawn stroke: must differ from the undrawn pixel there.
    assert drawn.getpixel((80, 50)) != undrawn.getpixel((80, 50))


def test_on_card_callback_runs_once_per_card(tmp_path):
    images = [_image(path=f"images/{i}.jpg", boxes=[_box(id=f"b{i}")]) for i in range(3)]
    calls = []
    html_out.write(
        images,
        CLASSES,
        tmp_path,
        project_name="P",
        export_time=EXPORT_TIME,
        settings=SETTINGS,
        thumbnail_fn=lambda i: None,
        on_card=lambda done, total: calls.append((done, total)),
    )
    assert calls == [(1, 3), (2, 3), (3, 3)]
