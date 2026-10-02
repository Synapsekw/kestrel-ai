# backend/tests/test_asset_model_look_cloud.py
"""Cloud sample, slice and fit (spec §7.3 as amended; Review Focus 2)."""

import io

import numpy as np
import pytest
from look_helpers import las_cylinder
from PIL import Image
from pointclouds import insert_cloud

from app.asset_models.look import LookError
from app.asset_models.look.cloud import CloudSample, cloud_fit, cloud_slice, sample_cloud, source_of
from app.jobs.cancellation import JobCancelled

ORIGIN = (500000.0, 4000000.0, 10.0)


@pytest.fixture(scope="module")
def las(tmp_path_factory):
    return las_cylinder(tmp_path_factory.mktemp("c") / "c.las", 300_000, origin=ORIGIN)


def test_sample_is_bounded_and_single_pass(las, monkeypatch):
    import laspy

    opened = []
    real_open = laspy.open
    monkeypatch.setattr(laspy, "open", lambda *a, **k: opened.append(1) or real_open(*a, **k))
    calls = []
    s = sample_cloud(las, max_points=50_000, progress=lambda d, t: calls.append((d, t)))
    assert len(s.xyz) <= 50_000 and len(s.xyz) > 40_000
    assert s.total == 300_000
    assert len(opened) == 1
    assert calls and calls[-1][0] == calls[-1][1]
    assert s.points()[:, 2].min() >= ORIGIN[2] - 0.01


def test_sample_honours_cancel(las):
    def stop():
        raise JobCancelled()

    with pytest.raises(JobCancelled):
        sample_cloud(las, check_cancelled=stop)


def test_sample_round_trips(las, tmp_path):
    s = sample_cloud(las, max_points=10_000)
    s.save(tmp_path / "s.npz")
    t = CloudSample.load(tmp_path / "s.npz")
    assert np.array_equal(s.xyz, t.xyz) and np.array_equal(s.offset, t.offset)


def test_slice_returns_a_ring_image_and_bounded_points(las):
    s = sample_cloud(las, max_points=100_000)
    r = cloud_slice(s, "z", ORIGIN[2] + 4.0, 0.2, max_points=500)
    assert len(r.points) == 500 and r.in_slab > 500
    pts = np.array(r.points)
    radius = np.hypot(pts[:, 0] - ORIGIN[0], pts[:, 1] - ORIGIN[1])
    assert np.median(radius) == pytest.approx(2.0, abs=0.01)
    assert Image.open(io.BytesIO(r.png)).size[0] <= 1024


def test_fit_circle_and_vertical_cylinder(las):
    s = sample_cloud(las, max_points=200_000)
    box = [ORIGIN[0] - 3, ORIGIN[1] - 3, ORIGIN[2] + 2, ORIGIN[0] + 3, ORIGIN[1] + 3, ORIGIN[2] + 6]
    c = cloud_fit(s, "circle", box)
    assert c["radius"] == pytest.approx(2.0, abs=0.005)
    assert c["center"] == pytest.approx([ORIGIN[0], ORIGIN[1]], abs=0.005)
    assert c["inlier_share"] > 0.95
    cyl = cloud_fit(s, "cylinder_vertical", box)
    assert cyl["radius"] == pytest.approx(2.0, abs=0.005)
    assert abs(cyl["tilt_per_m"][0]) < 0.002 and abs(cyl["tilt_per_m"][1]) < 0.002


def test_fit_plane():
    rng = np.random.default_rng(0)
    xyz = np.column_stack([rng.uniform(0, 4, 5000), rng.uniform(0, 4, 5000), np.full(5000, 0.5)])
    s = CloudSample(np.zeros(3), xyz.astype(np.float32), 5000)
    p = cloud_fit(s, "plane", None)
    assert abs(p["normal"][2]) == pytest.approx(1.0, abs=1e-3)
    assert p["rms_m"] < 1e-4


def test_fit_with_too_few_points_says_so(las):
    s = sample_cloud(las, max_points=10_000)
    r = cloud_fit(s, "circle", [0, 0, 0, 1, 1, 1])
    assert r["n"] < 3 and "too few points" in r["note"]


def test_source_of_unknown_cloud_raises_look_error(handle):
    with pytest.raises(LookError, match="can't be read"):
        source_of(handle, "no-such-cloud")


def test_source_of_ready_cloud_returns_the_source(handle, las):
    st = las.stat()
    cloud_id = insert_cloud(handle, source_path=str(las), source_size=st.st_size, source_mtime=st.st_mtime)
    assert source_of(handle, cloud_id) == las


def test_slice_image_draws_every_slab_point_not_a_file_order_prefix():
    n = 250_000
    xyz = np.zeros((n, 3), np.float32)
    xyz[:200_000, 0] = np.linspace(0, 1, 200_000)  # first 200k: left edge region
    xyz[200_000:, 0] = 9.0 + np.linspace(0, 1, n - 200_000)  # later points: far right
    xyz[:, 1] = 0.5
    s = CloudSample(np.zeros(3), xyz, n)
    r = cloud_slice(s, "z", 0.0, 1.0)
    img = np.asarray(Image.open(io.BytesIO(r.png)).convert("RGB"))
    lit = np.all(img == (120, 200, 255), axis=2)
    right = lit[:, img.shape[1] // 2 :]
    assert r.in_slab == n and right.any()
