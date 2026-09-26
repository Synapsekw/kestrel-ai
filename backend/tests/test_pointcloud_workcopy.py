"""Streamed work copy + hash, header bounds at byte 179, header repair (spec §6.3, §6.6)."""

import errno
import hashlib
import io
import os

import laspy
import numpy as np
import pytest
from pointclouds import make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import lasbounds, workcopy


def _noop(*_a):
    return None


def test_hash_equals_hashlib_and_the_source_is_untouched(tmp_path):
    src = make_las(tmp_path / "src.las", 20_000)
    before = (src.read_bytes(), os.stat(src).st_mtime_ns)
    seen: list[tuple[int, int]] = []
    sha = workcopy.copy_and_hash(
        src,
        tmp_path / "work" / "input.las",
        progress=lambda d, t: seen.append((d, t)),
        check_cancelled=_noop,
        chunk=100_000,
    )
    assert sha == hashlib.sha256(src.read_bytes()).hexdigest()
    assert (tmp_path / "work" / "input.las").read_bytes() == src.read_bytes()
    assert seen[-1] == (src.stat().st_size, src.stat().st_size) and len(seen) > 3
    assert (src.read_bytes(), os.stat(src).st_mtime_ns) == before


def test_cancel_mid_copy_removes_the_partial_copy(tmp_path):
    src = make_las(tmp_path / "src.las", 20_000)
    calls = {"n": 0}

    def cancel_on_third():
        calls["n"] += 1
        if calls["n"] == 3:
            raise JobCancelled()

    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobCancelled):
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=cancel_on_third, chunk=100_000)
    assert not dest.exists()


class _FlakySource(io.BytesIO):
    def read(self, n=-1):
        if self.tell() > 0:
            raise OSError(errno.EIO, "The specified network name is no longer available")
        return super().read(n)


def test_source_vanishing_mid_copy_fails_readably(tmp_path, monkeypatch):
    """Review Focus 2: the NAS drops half-way through."""
    src = make_las(tmp_path / "src.las", 20_000)
    monkeypatch.setattr(workcopy, "_open_source", lambda p: _FlakySource(p.read_bytes()))
    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobFailure) as e:
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=_noop, chunk=100_000)
    assert str(e.value).startswith(f"could not read the source file: {src} (")
    assert "no longer available" in str(e.value)
    assert not dest.exists()


class _FullDisk(io.BytesIO):
    def write(self, b):
        raise OSError(errno.ENOSPC, "There is not enough space on the disk")


def test_full_project_drive_fails_readably(tmp_path, monkeypatch):
    """Review Focus 3: another program filled the drive after admission passed."""
    src = make_las(tmp_path / "src.las", 2_000)
    monkeypatch.setattr(workcopy, "_open_dest", lambda p: _FullDisk())
    dest = tmp_path / "work" / "input.las"
    with pytest.raises(JobFailure) as e:
        workcopy.copy_and_hash(src, dest, progress=_noop, check_cancelled=_noop)
    assert str(e.value) == "the project drive is full; free some space and import again"


@pytest.mark.parametrize(
    ("name", "kwargs"),
    [
        ("v12.las", {"version": "1.2", "point_format": 3}),
        ("v14.las", {"version": "1.4", "point_format": 6, "rgb": False}),
        ("v12.laz", {"version": "1.2", "point_format": 3, "compressed": True}),
    ],
)
def test_byte_179_holds_the_bounds_in_las_12_14_and_laz(tmp_path, name, kwargs):
    path = make_las(tmp_path / name, 500, **kwargs)
    with laspy.open(path) as r:
        expected = [*r.header.mins, *r.header.maxs]
    assert lasbounds.read_header_bounds(path) == pytest.approx(expected, abs=1e-9)
    lasbounds.write_header_bounds(path, [1, 2, 3, 4, 5, 6])
    with laspy.open(path) as r:
        assert [*r.header.mins, *r.header.maxs] == [1, 2, 3, 4, 5, 6]


def test_write_refuses_a_file_that_is_not_las(tmp_path):
    p = tmp_path / "x.las"
    p.write_bytes(b"NOTLAS" + b"\0" * 300)
    with pytest.raises(ValueError):
        lasbounds.write_header_bounds(p, [0, 0, 0, 1, 1, 1])


def test_widen_and_contains():
    assert lasbounds.widen([0, 0, 0, 1, 1, 1], [0.001, 0.01, 0.1]) == pytest.approx(
        [-0.001, -0.01, -0.1, 1.001, 1.01, 1.1]
    )
    assert lasbounds.contains([0, 0, 0, 2, 2, 2], [0, 0, 0, 2, 2, 2])
    assert not lasbounds.contains([0, 0, 0, 2, 2, 2], [0, 0, 0, 2.0003, 2, 2])


def _true_bounds(path):
    with laspy.open(path) as r:
        las = r.read()
    xyz = np.column_stack([las.x, las.y, las.z])
    return [*xyz.min(0), *xyz.max(0)]


def test_repair_fixes_the_pix4d_header(tmp_path):
    path = make_las(tmp_path / "pix4d.las", 5_000, header_shrink_mm=0.3)
    bounds = _true_bounds(path)
    assert workcopy.repair_header(path, bounds, [0.001, 0.001, 0.001]) is True
    with laspy.open(path) as r:
        mins, maxs = r.header.mins, r.header.maxs
    assert all(mins <= np.array(bounds[:3])) and all(maxs >= np.array(bounds[3:]))
    assert maxs[0] == pytest.approx(bounds[3] + 0.001, abs=1e-9)


def test_a_correct_header_still_gets_the_widened_bounds(tmp_path):
    path = make_las(tmp_path / "ok.las", 5_000)
    bounds = _true_bounds(path)
    assert workcopy.repair_header(path, bounds, [0.001, 0.001, 0.001]) is False
    assert lasbounds.read_header_bounds(path) == pytest.approx(
        lasbounds.widen_for_converter(bounds, [0.001] * 3), abs=1e-9
    )


# §17.9 first acceptance: the chimney's source minimum X 243194.298 widened one step became the
# double 243194.29700000002, a hair above the 1 mm grid. PotreeConverter 2.1.5 takes that as its
# offset and truncates (x - offset) / scale, so every grid value landed at k - eps -> k - 1: each
# pick decoded one millimetre low.
CHIMNEY_GRID_BOUNDS = [243194.298, 3177915.060, -141.185, 245353.937, 3180119.464, 189.554]


def test_the_repaired_minimum_sits_just_below_the_source_grid(tmp_path):
    path = make_las(tmp_path / "grid.las", 500)
    scale = [0.001, 0.001, 0.001]
    workcopy.repair_header(path, CHIMNEY_GRID_BOUNDS, scale)
    header = lasbounds.read_header_bounds(path)
    assert lasbounds.contains(header, CHIMNEY_GRID_BOUNDS)
    for axis in range(3):
        lo, s = CHIMNEY_GRID_BOUNDS[axis], scale[axis]
        for k in (0, 1, 7, 123_456, 2_159_639):
            x = lo + k * s  # a value on the source grid, as the converter reads it (a double)
            steps = (x - header[axis]) / s
            # truncation must land on k + 1 (the widening step) with a margin far above rounding noise
            assert int(steps) == k + 1, (axis, k, steps)
            assert steps - (k + 1) > 1e-4, (axis, k, steps)


def test_widen_for_converter_nudges_only_the_minimum():
    b = lasbounds.widen_for_converter([0, 0, 0, 1, 1, 1], [0.001, 0.01, 0.1])
    assert b[3:] == pytest.approx([1.001, 1.01, 1.1], abs=1e-12)
    assert b[:3] == pytest.approx([-0.001001, -0.01001, -0.1001], abs=1e-12)
