from datetime import UTC, datetime

import piexif
from PIL import Image

from app.datasets.prepare import list_images, process_one, unique_dest


def test_list_images_filters_and_sorts(tmp_path, make_jpeg):
    make_jpeg(tmp_path / "b.jpg", 8, 8)
    make_jpeg(tmp_path / "sub" / "a.JPG", 8, 8)
    (tmp_path / "notes.txt").write_text("x")
    found = list_images(tmp_path)
    assert [p.name for p in found] == ["b.jpg", "a.JPG"]  # sorted by full path, notes.txt excluded
    assert found == sorted(found)


def test_unique_dest_avoids_collisions(tmp_path):
    taken: set[str] = set()
    assert unique_dest(tmp_path, "a", taken).name == "a.jpg"
    assert unique_dest(tmp_path, "a", taken).name == "a_1.jpg"
    assert unique_dest(tmp_path, "A", taken).name == "A_2.jpg"  # case-insensitive filesystem


def test_process_one_downscales_and_keeps_exif(tmp_path, make_jpeg):
    src = make_jpeg(
        tmp_path / "src.jpg",
        6000,
        4000,
        exif={"DateTimeOriginal": "2019:04:15 06:35:36", "lat": 29.49469, "lon": 47.76513, "alt": 191.3},
    )
    out = process_one(str(src), str(tmp_path / "out.jpg"), max_side=4000, quality=95)
    assert out.action == "downscaled" and (out.width, out.height) == (4000, 2667)
    assert out.capture_time == datetime(2019, 4, 15, 6, 35, 36, tzinfo=UTC)
    assert abs(out.lat - 29.49469) < 1e-4 and abs(out.lon - 47.76513) < 1e-4 and abs(out.alt - 191.3) < 0.01
    assert len(out.phash) == 16
    with Image.open(tmp_path / "out.jpg") as im:
        assert im.size == (4000, 2667)
        assert im.getexif().get_ifd(0x8769).get(36867) == "2019:04:15 06:35:36"


def test_process_one_converts_png_without_downscale(tmp_path):
    Image.new("RGBA", (300, 200), (10, 20, 30, 255)).save(tmp_path / "x.png")
    out = process_one(str(tmp_path / "x.png"), str(tmp_path / "x.jpg"), 4000, 95)
    assert out.action == "converted" and (out.width, out.height) == (300, 200) and out.capture_time is None
    assert out.lat is None and out.lon is None and out.alt is None


def test_process_one_applies_orientation_and_clears_the_tag(tmp_path, make_jpeg):
    src = make_jpeg(tmp_path / "rot.jpg", 300, 200, exif={"orientation": 6})
    out = process_one(str(src), str(tmp_path / "rot_out.jpg"), 4000, 95)
    assert (out.width, out.height) == (200, 300)  # rotated, so the sides swap
    with Image.open(tmp_path / "rot_out.jpg") as im:
        assert im.size == (200, 300)
        assert im.getexif().get(piexif.ImageIFD.Orientation, 1) == 1  # no second rotation in a viewer


def test_process_one_reports_failure_instead_of_raising(tmp_path):
    (tmp_path / "bad.jpg").write_bytes(b"not an image")
    out = process_one(str(tmp_path / "bad.jpg"), str(tmp_path / "bad_out.jpg"), 4000, 95)
    assert out.action == "failed" and out.error
    assert not (tmp_path / "bad_out.jpg").exists()


def test_process_one_existing_dest_is_reused(tmp_path):
    # A structured image, not noise: the phash of pure noise is not stable across a JPEG round trip,
    # so noise would make the "same hash" assertion flaky rather than meaningful.
    src = tmp_path / "s.jpg"
    Image.linear_gradient("L").rotate(20).convert("RGB").resize((100, 50)).save(src, "JPEG", quality=95)
    dest = tmp_path / "d.jpg"
    first = process_one(str(src), str(dest), 4000, 95)
    second = process_one(str(src), str(dest), 4000, 95)
    assert first.action == "converted"
    assert second.action == "existing" and second.phash == first.phash
    assert (second.width, second.height) == (100, 50)


def test_real_frame_matches_manifest(ahmadia_sample, tmp_path):
    out = process_one(str(ahmadia_sample / "IX-12-02491_0031_0001.jpg"), str(tmp_path / "o.jpg"), 4000, 95)
    assert (out.width, out.height) == (4000, 2667) and out.phash == "82a81f67f94615ae"
    assert out.capture_time == datetime(2019, 4, 15, 6, 35, 36, tzinfo=UTC)
    assert abs(out.lat - 29.49469) < 1e-4 and abs(out.lon - 47.76513) < 1e-4
    assert abs(out.alt - 191.3) < 0.1


def test_orientation_is_cleared_even_when_piexif_cannot_parse(tmp_path, make_jpeg, monkeypatch):
    """Falling back to the raw EXIF would re-apply a rotation the pixels already have."""
    from app.datasets import prepare

    def _boom(_):
        raise ValueError("unparsable exif")

    monkeypatch.setattr(prepare.piexif, "load", _boom)
    src = make_jpeg(tmp_path / "rot.jpg", 300, 200, exif={"orientation": 6})
    out = prepare.process_one(str(src), str(tmp_path / "out.jpg"), 4000, 95)
    assert (out.width, out.height) == (200, 300)
    with Image.open(tmp_path / "out.jpg") as im:
        assert im.size == (200, 300)
        assert im.getexif().get(piexif.ImageIFD.Orientation, 1) == 1
