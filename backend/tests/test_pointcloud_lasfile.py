"""Header-only inspection (spec §4.1 op 3): the facts, and never more than 1 MiB read."""

import io
from datetime import date

import pytest
from pointclouds import make_las

from app.pointclouds import lasfile


class CountingFile(io.FileIO):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.bytes_read = 0

    def read(self, n=-1):
        b = super().read(n)
        self.bytes_read += len(b or b"")
        return b

    def readinto(self, buf):
        n = super().readinto(buf)
        self.bytes_read += n or 0
        return n


@pytest.mark.parametrize("name", ["big.las", "big.laz"])
def test_reads_only_the_header_and_vlrs(tmp_path, name):
    path = make_las(tmp_path / name, 1_000_000, compressed=name.endswith(".laz"))
    f = CountingFile(path)
    info = lasfile.header_info(f, path, path.stat().st_size)
    f.close()
    assert f.bytes_read <= 1 << 20
    assert info.point_count == 1_000_000 and info.compressed is name.endswith(".laz")


def test_header_facts(tmp_path):
    path = make_las(tmp_path / "a.las", 1000, header_shrink_mm=0.3)
    info = lasfile.inspect_file(path)
    assert (info.las_version, info.point_format, info.record_len, info.has_rgb) == ("1.2", 3, 34, True)
    assert info.crs.epsg == 32639 and info.scale == [0.001, 0.001, 0.001]
    assert len(info.header_bounds) == 6 and info.header_bounds[3] > info.header_bounds[0]
    assert info.captured_on == date.today()
    assert "GeoKeyDirectoryVlr" in info.vlrs


def test_no_rgb_formats(tmp_path):
    info = lasfile.inspect_file(make_las(tmp_path / "b.las", 10, version="1.4", point_format=6, rgb=False))
    assert info.has_rgb is False and info.record_len == 30


@pytest.mark.parametrize("content", [b"", b"NOTLAS" * 100, b"LASF" + b"\0" * 50])
def test_not_a_las_file_is_unsupported(tmp_path, content):
    p = tmp_path / "x.las"
    p.write_bytes(content)
    with pytest.raises(lasfile.UnsupportedCloud) as e:
        lasfile.inspect_file(p)
    assert str(e.value).startswith("this is not a readable LAS or LAZ file:")


def test_wrong_extension_is_unsupported(tmp_path):
    p = tmp_path / "cloud.e57"
    p.write_bytes(b"x")
    with pytest.raises(lasfile.UnsupportedCloud) as e:
        lasfile.inspect_file(p)
    assert str(e.value) == "only .las and .laz point clouds can be imported (got .e57)"
