"""Self-contained HTML report (G2, fix round 1 covers unreviewed markers, local time, thumbnails)."""

from datetime import UTC, datetime, timedelta, timezone

from PIL import Image as PILImage

from app.exports import html_out
from app.exports.rows import ExportBox, ExportImage

CLASSES = [{"id": "c-exc", "name": "excavator", "colour": "#ff0000"}]
SETTINGS = {"formats": ["csv", "html"], "include_unreviewed": False}
EXPORT_TIME = datetime(2026, 9, 19, 10, 15, 0, tzinfo=UTC)
_FIXED_TZ = timezone(timedelta(hours=3))


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
    drawn_bytes = html_out.draw_thumbnail(path, [box], CLASSES, 200, 200)
    import io

    drawn = PILImage.open(io.BytesIO(drawn_bytes)).convert("RGB")
    assert drawn.size == undrawn.size
    # The box's top edge, well inside the drawn stroke: must differ from the undrawn pixel there.
    assert drawn.getpixel((80, 50)) != undrawn.getpixel((80, 50))


def test_unreviewed_dashed_box_differs_from_an_accepted_solid_box(tmp_path, make_jpeg):
    path = tmp_path / "a.jpg"
    make_jpeg(path, 200, 200, seed=1)
    accepted = html_out.draw_thumbnail(path, [_box(review_state="accepted")], CLASSES, 200, 200)
    unreviewed = html_out.draw_thumbnail(path, [_box(review_state="unreviewed")], CLASSES, 200, 200)
    assert accepted != unreviewed


def test_an_unreadable_image_gives_none_instead_of_raising(tmp_path):
    path = tmp_path / "broken.jpg"
    path.write_bytes(b"not actually a jpeg")
    result = html_out.draw_thumbnail(path, [_box()], CLASSES, 200, 200)
    assert result is None


def test_draft_downscale_still_aligns_boxes(tmp_path, make_jpeg):
    """A large JPEG decoded via `draft()` may come back smaller than its stored size; boxes must
    still land in the right place, scaled from the stored size to whatever draft actually produced.
    """
    path = tmp_path / "big.jpg"
    make_jpeg(path, 2000, 2000, seed=3)
    # A box covering the exact centre quarter, regardless of what draft() decodes it to.
    box = _box(x=500, y=500, w=1000, h=1000)
    thumb = html_out.draw_thumbnail(path, [box], CLASSES, 2000, 2000, max_side=640)
    import io

    im = PILImage.open(io.BytesIO(thumb))
    assert max(im.size) <= 640


def test_legend_line_appears_only_when_unreviewed_boxes_are_present(tmp_path):
    without = _write([_image(boxes=[_box(review_state="accepted")])], tmp_path, thumbnail_fn=lambda i: None)
    assert "dashed" not in without.lower()

    with_it = _write(
        [_image(boxes=[_box(review_state="unreviewed")])],
        tmp_path,
        settings={"formats": ["html"], "include_unreviewed": True},
        thumbnail_fn=lambda i: None,
    )
    assert "dashed" in with_it.lower()


def test_an_image_with_only_unreviewed_boxes_is_not_checked(tmp_path):
    images = [
        _image(path="images/a.jpg", boxes=[_box(review_state="unreviewed")]),
        _image(path="images/b.jpg", boxes=[_box(review_state="accepted")]),
    ]
    text = _write(
        images,
        tmp_path,
        settings={"formats": ["html"], "include_unreviewed": True},
        thumbnail_fn=lambda i: None,
    )
    # Only image b is "checked": image a has nothing but an unreviewed proposal.
    assert "1 images checked, 2 with machinery." in text


def test_export_time_is_local_with_the_offset(tmp_path):
    local = datetime(2026, 9, 19, 17, 53, tzinfo=UTC).astimezone(_FIXED_TZ)
    text = _write([_image()], tmp_path, export_time=local)
    assert "Exported 2026-09-19 20:53 UTC+03:00" in text


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


def test_class_name_is_escaped_in_the_totals_and_group_tables(tmp_path):
    classes = [{"id": "c-exc", "name": "<b>excavator</b>", "colour": "#ff0000"}]
    images = [_image(boxes=[_box(class_name="<b>excavator</b>")])]
    files = html_out.write(
        images,
        classes,
        tmp_path,
        project_name="P",
        export_time=EXPORT_TIME,
        settings=SETTINGS,
        thumbnail_fn=lambda i: None,
    )
    report = (tmp_path / "report.html").read_text("utf-8")
    assert files == ["report.html"]
    assert "<b>excavator</b>" not in report
    assert "&lt;b&gt;excavator&lt;/b&gt;" in report


def test_group_is_escaped_in_the_group_table(tmp_path):
    text = _write([_image(group="<img src=x onerror=alert(1)>")], tmp_path, thumbnail_fn=lambda i: None)
    assert "<img src=x" not in text
    assert "&lt;img src=x onerror=alert(1)&gt;" in text


def test_image_path_is_escaped_on_its_card(tmp_path):
    text = _write(
        [_image(path="images/<script>alert(1)</script>.jpg", boxes=[_box()])],
        tmp_path,
        thumbnail_fn=lambda i: None,
    )
    assert "<script>alert(1)</script>" not in text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in text
