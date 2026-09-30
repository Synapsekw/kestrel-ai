"""R3: the snapshot cache and the placeholder (spec 2026-09-26-reports §6.3, §9.5, §16)."""

import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage
from PIL import ImageDraw, JpegImagePlugin

from app.reports.snapshots.cache import (
    cache_dir,
    cached_path,
    placeholder_path,
    prune,
    touch,
    write_jpeg,
)
from app.reports.snapshots.placeholder import BG, render_placeholder


def _h(tmp_path):
    return SimpleNamespace(folder=tmp_path)


def _file(folder: Path, name: str, size: int, mtime_s: int) -> Path:
    p = folder / name
    p.write_bytes(b"x" * size)
    os.utime(p, ns=(mtime_s * 10**9, mtime_s * 10**9))
    return p


def test_the_same_image_encodes_to_the_same_bytes_4_2_0_without_exif(tmp_path):
    img = PILImage.new("RGB", (64, 48), (10, 120, 200))
    ImageDraw.Draw(img).line([(0, 0), (63, 47)], fill=(255, 255, 255), width=3)
    a = write_jpeg(img, tmp_path / "a.jpg")
    b = write_jpeg(img, tmp_path / "b.jpg")
    assert a.read_bytes() == b.read_bytes()
    with PILImage.open(a) as im:
        assert im.format == "JPEG" and "exif" not in im.info and not im.getexif()
        assert JpegImagePlugin.get_sampling(im) == 2
    assert not list(tmp_path.glob("*.tmp"))


def test_the_cache_lives_under_reports_and_accepts_only_keys(tmp_path):
    assert cache_dir(_h(tmp_path)) == tmp_path / "reports" / ".cache" / "snapshots"
    assert cached_path(_h(tmp_path), "0" * 32).name == "0" * 32 + ".jpg"
    for bad in ("../x", "0" * 31, "G" * 32, "0" * 32 + "/.."):
        with pytest.raises(ValueError):
            cached_path(_h(tmp_path), bad)


def test_prune_removes_the_least_recently_used_until_under_the_cap(tmp_path):
    d = cache_dir(_h(tmp_path))
    d.mkdir(parents=True)
    files = [_file(d, f"{i:032x}.jpg", 100, 1_700_000_000 + i) for i in range(5)]
    touch(files[0])  # a cache hit makes the oldest file the most recent
    assert prune(_h(tmp_path), cap_bytes=250) == 300
    assert sorted(p.name for p in d.iterdir()) == sorted([files[0].name, files[4].name])


def test_prune_skips_a_file_it_cannot_delete(tmp_path, monkeypatch):
    d = cache_dir(_h(tmp_path))
    d.mkdir(parents=True)
    files = [_file(d, f"{i:032x}.jpg", 100, 1_700_000_000 + i) for i in range(3)]
    real_unlink = Path.unlink

    def unlink(self, *args, **kwargs):
        if self.name == files[0].name:
            raise PermissionError("in use by another reader")
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unlink)
    assert prune(_h(tmp_path), cap_bytes=200) == 100
    assert files[0].exists() and not files[1].exists() and files[2].exists()


def test_prune_of_a_project_without_a_cache_is_a_no_op(tmp_path):
    assert prune(_h(tmp_path)) == 0


def test_a_placeholder_is_grey_sized_and_shared_by_reason(tmp_path):
    h = _h(tmp_path)
    p = placeholder_path(h, "The image file is missing", (1200, 900))
    assert p.name.startswith("ph-") and p.parent == cache_dir(h)
    assert p == placeholder_path(h, "The image file is missing", (1200, 900))
    assert p != placeholder_path(h, "The map was deleted", (1200, 900))
    with PILImage.open(p) as im:
        assert im.size == (1200, 900)
    img = render_placeholder("The image file is missing", (400, 300))
    assert img.size == (400, 300) and img.getpixel((200, 5)) == BG
