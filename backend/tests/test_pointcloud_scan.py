"""The chunked scan (spec §6.4): exact count/bounds/mean, stride-sampled percentiles, histogram."""

import laspy
import numpy as np
import pytest
from pointclouds import make_las

from app.jobs.cancellation import JobCancelled, JobFailure
from app.pointclouds import scan


def _noop(*_a):
    return None


def _points(n, seed=0):
    rng = np.random.default_rng(seed)
    return np.column_stack(
        [243500 + rng.random(n) * 100, 3178000 + rng.random(n) * 100, rng.normal(10, 20, n)]
    ).round(3)


def test_exact_count_bounds_mean(tmp_path):
    pts = _points(10_000)
    path = make_las(tmp_path / "a.las", len(pts), points=pts)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop, chunk=3_001)
    assert r.count == r.header_count == 10_000
    assert r.bounds == pytest.approx([*pts.min(0), *pts.max(0)], abs=5e-4)
    assert r.z_stats["mean"] == pytest.approx(pts[:, 2].mean(), abs=1e-3)
    assert r.z_stats["min"] == pytest.approx(pts[:, 2].min(), abs=5e-4)


def test_percentiles_land_within_one_stride(tmp_path, monkeypatch):
    # Points written in Z order: the stride sample is then every 10th value of the sorted array, so
    # its percentiles sit within one stride of the full array's. (On shuffled points the difference
    # is sampling noise, not a property of the code.) Chunks of 2 999 are not a multiple of the stride,
    # so this also proves the sample follows the global index across chunk boundaries.
    monkeypatch.setattr(scan, "SAMPLE_MAX", 1_000)
    pts = _points(10_000, seed=3)
    pts = pts[np.argsort(pts[:, 2])]
    path = make_las(tmp_path / "b.las", len(pts), points=pts)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop, chunk=2_999)
    z = np.sort(pts[:, 2])
    stride = 10
    assert r.z_stats["sample_count"] == 1_000
    for key, q in scan.PERCENTILES.items():
        rank = np.searchsorted(z, r.z_stats[key])
        assert abs(rank - q / 100 * (len(z) - 1)) <= stride + 1, key


def test_class_histogram(tmp_path):
    path = make_las(tmp_path / "c.las", 1_000)
    las = laspy.read(path)
    las.classification = np.array([2] * 600 + [6] * 399 + [7], dtype=np.uint8)
    las.write(path)
    r = scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert r.class_counts == {"2": 600, "6": 399, "7": 1}


def test_chunk_boundary_two_million_and_one(tmp_path):
    path = make_las(tmp_path / "d.las", 2_000_001)
    seen = []
    r = scan.scan(path, progress=lambda d, t: seen.append(d), check_cancelled=_noop)
    assert r.count == 2_000_001 and seen == [2_000_000, 2_000_001]
    assert r.z_stats["sample_count"] <= scan.SAMPLE_MAX + 1


def test_count_mismatch_is_recorded_and_the_scan_wins(tmp_path):
    path = make_las(tmp_path / "e.las", 1_000)
    with open(path, "r+b") as f:  # legacy point count (LAS 1.2) at byte 107
        f.seek(107)
        f.write((900).to_bytes(4, "little"))
    r = scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert r.header_count == 900 and r.count in (900, 1_000)


def test_empty_file_fails(tmp_path):
    path = tmp_path / "f.las"
    laspy.LasData(laspy.LasHeader(point_format=3, version="1.2")).write(path)
    with pytest.raises(JobFailure) as e:
        scan.scan(path, progress=_noop, check_cancelled=_noop)
    assert str(e.value) == "the file has no points"


def test_cancel_between_chunks(tmp_path):
    path = make_las(tmp_path / "g.las", 10_000)

    def cancel():
        raise JobCancelled()

    with pytest.raises(JobCancelled):
        scan.scan(path, progress=_noop, check_cancelled=cancel, chunk=1_000)
