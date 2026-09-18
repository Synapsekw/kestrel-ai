"""The dataset tests lean on these fixtures; check them once so their failures are unambiguous."""

from PIL import Image


def test_make_jpeg_writes_exif(make_jpeg, tmp_path):
    p = make_jpeg(
        tmp_path / "a.jpg",
        640,
        480,
        exif={"DateTimeOriginal": "2019:04:15 06:35:36", "lat": 29.5, "lon": 47.7, "alt": 191.0},
    )
    im = Image.open(p)
    assert im.size == (640, 480)
    assert im.getexif().get_ifd(0x8769).get(36867) == "2019:04:15 06:35:36"


def test_ahmadia_sample_has_twenty_frames(ahmadia_sample):
    files = sorted(ahmadia_sample.glob("*.jpg"))
    assert len(files) == 20 and files[0].name == "IX-12-02491_0031_0001.jpg"


def test_project_fixture_has_eight_classes(project):
    assert [c["name"] for c in project["classes"]][:2] == ["excavator", "wheel_loader"]
    assert len(project["classes"]) == 8
