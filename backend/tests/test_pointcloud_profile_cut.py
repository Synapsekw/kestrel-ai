"""C-B2 Task 1: the streaming cut (spec 2026-09-26-point-cloud-workspace sections 8.2 and 8.4, 15)."""

import numpy as np
import pytest
from pointclouds import make_las
from profile_helpers import X0, Y0, Z0, wall_section

from app.jobs.cancellation import JobCancelled
from app.pointclouds import profile_cut


def _cut(src, *, length=10.0, dy=0.0, thickness=0.2, max_points=200_000, progress=None, check=None):
    return profile_cut.cut(
        src,
        a=(X0, Y0 + dy),
        b=(X0 + length, Y0 + dy),
        thickness_m=thickness,
        max_points=max_points,
        scale=0.001,
        progress=progress or (lambda done, total: None),
        check_cancelled=check or (lambda: None),
    )


def test_a_wall_on_ground_gives_its_thickness(tmp_path):
    src = make_las(tmp_path / "wall.las", 0, points=wall_section())
    cut = _cut(src)
    assert cut.count == len(wall_section())  # every point is in the 0.2 m slab
    assert cut.width_max_m == pytest.approx(0.4, abs=0.001)  # one scale step
    assert cut.length_m == pytest.approx(10.0)
    assert cut.z_min == pytest.approx(Z0) and cut.z_max == pytest.approx(Z0 + 10.0)
    assert cut.s.dtype == np.float32 and cut.z.dtype == np.float32
    assert cut.rgb is not None and cut.rgb.dtype == np.uint8 and cut.rgb.shape == (cut.count, 3)
    assert set(np.unique(cut.rgb)) <= {0, 255}  # make_las writes 16-bit 65535/0
    assert cut.cell_m is None  # nothing was thinned


def test_the_slab_keeps_its_edges_and_drops_one_step_outside(tmp_path):
    inside = [(X0 + 5, Y0 + 0.1, Z0), (X0 + 5, Y0 - 0.1, Z0), (X0, Y0, Z0), (X0 + 10, Y0, Z0)]
    outside = [
        (X0 + 5, Y0 + 0.101, Z0),
        (X0 + 5, Y0 - 0.101, Z0),
        (X0 - 0.001, Y0, Z0),
        (X0 + 10.001, Y0, Z0),
    ]
    src = make_las(tmp_path / "edges.las", 0, points=np.array(inside + outside))
    cut = _cut(src, thickness=0.2)
    assert cut.count == 4
    assert sorted(np.round(cut.s.astype(float), 3).tolist()) == [0.0, 5.0, 5.0, 10.0]


def test_an_empty_slab_is_a_valid_empty_profile(tmp_path):
    src = make_las(tmp_path / "wall.las", 0, points=wall_section())
    cut = _cut(src, dy=3.0)
    assert (cut.count, cut.width_max_m, cut.z_min, cut.z_max) == (0, None, None, None)
    assert cut.s.shape == (0,) and cut.rgb is not None and cut.rgb.shape == (0, 3)


def test_a_cloud_without_colour_answers_no_rgb(tmp_path):
    src = make_las(tmp_path / "grey.las", 0, points=wall_section(), rgb=False, point_format=1)
    assert _cut(src).rgb is None


def test_thinning_keeps_max_points_and_the_z_extremes(tmp_path):
    pts = wall_section(step=0.02)
    src = make_las(tmp_path / "dense.las", 0, points=pts)
    cut = _cut(src, max_points=1000)
    assert 0 < cut.count <= 1000
    assert cut.cell_m is not None and cut.cell_m >= 10.0 / 4000
    assert float(cut.z.min()) == pytest.approx(pts[:, 2].min(), abs=1e-4)
    assert float(cut.z.max()) == pytest.approx(pts[:, 2].max(), abs=1e-4)
    assert cut.width_max_m == pytest.approx(0.4, abs=0.001)  # measured before the final thin


def test_progress_is_by_points_and_cancel_is_checked_between_chunks(tmp_path, monkeypatch):
    monkeypatch.setattr(profile_cut, "CHUNK", 500)
    src = make_las(tmp_path / "wall.las", 0, points=wall_section())
    seen: list[tuple[int, int]] = []
    _cut(src, progress=lambda d, t: seen.append((d, t)))
    n = len(wall_section())
    assert seen[-1] == (n, n) and len(seen) == -(-n // 500)
    calls = {"n": 0}

    def cancel_on_second():
        calls["n"] += 1
        if calls["n"] == 2:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        _cut(src, check=cancel_on_second)


def test_chunk_boundary_and_bound_at_two_million_and_one(tmp_path):
    n = profile_cut.CHUNK + 1
    rng = np.random.default_rng(7)
    xyz = np.empty((n, 3))
    xyz[:, 0] = X0 + np.round(np.linspace(0, 10, n), 3)
    xyz[:, 1] = Y0
    xyz[:, 2] = Z0 + np.round(rng.random(n) * 5, 3)
    xyz[0, 2] = Z0 - 1.0  # the unique minimum, in the first chunk
    xyz[-1, 2] = Z0 + 6.0  # the unique maximum, the only point of the second chunk
    src = make_las(tmp_path / "big.las", 0, points=xyz)
    cut = _cut(src)
    assert cut.scanned == n
    assert cut.count <= 200_000
    assert float(cut.z.min()) == pytest.approx(Z0 - 1.0, abs=1e-4)
    assert float(cut.z.max()) == pytest.approx(Z0 + 6.0, abs=1e-4)
    assert cut.z_min == pytest.approx(Z0 - 1.0) and cut.z_max == pytest.approx(Z0 + 6.0)
    assert cut.cell_m is not None


def test_thin_to_meets_its_target_when_every_point_has_its_own_cell():
    s = np.linspace(0, 10, 50_000, dtype=np.float32)
    z = np.linspace(0, 1, 50_000, dtype=np.float32)[::-1].copy()
    out_s, out_z, out_c, cell = profile_cut.thin_to(s, z, None, 1000, 0.0025)
    assert len(out_s) <= 1000 and out_c is None and cell > 0.0025
    assert out_z.max() == z.max() and out_z.min() == z.min()


def test_width_ignores_flat_and_sloping_ground():
    s = np.arange(0, 20, 0.01, dtype=np.float32)
    assert profile_cut.width_max(s, np.zeros_like(s)) is None
    assert profile_cut.width_max(s, (0.05 * s).astype(np.float32)) is None


def test_width_of_a_chimney_section_is_its_thicker_shell():
    zs = np.arange(0.05, 10, 0.05)
    s = np.concatenate([np.full_like(zs, v) for v in (2.0, 2.3, 5.3, 5.65)]).astype(np.float32)
    z = np.tile(zs, 4).astype(np.float32)
    assert profile_cut.width_max(s, z) == pytest.approx(0.35, abs=1e-5)


def test_to_uint8_keeps_8_bit_colour_and_shifts_16_bit():
    assert profile_cut.to_uint8(np.array([[10, 20, 255]], dtype=np.uint16)).tolist() == [[10, 20, 255]]
    assert profile_cut.to_uint8(np.array([[65535, 256, 0]], dtype=np.uint16)).tolist() == [[255, 1, 0]]
