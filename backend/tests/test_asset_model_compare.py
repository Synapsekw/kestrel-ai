"""Cloud->asset transform, point-triangle distance and per-part comparison (spec §7.3)."""

import numpy as np
import pytest
import trimesh

from app.asset_models.compare import CloudTransform, closest_points, cloud_to_asset, compare


def test_transform_yaw_zero_maps_cloud_north_to_asset_x():
    t = CloudTransform(origin=(100.0, 200.0, 5.0), yaw_deg=0)
    out = cloud_to_asset(np.array([[100.0, 201.0, 5.0], [101.0, 200.0, 7.0]]), t)
    assert out[0] == pytest.approx([1, 0, 0])  # 1 m cloud-north -> asset X
    assert out[1] == pytest.approx([0, 2, 1])  # 1 m cloud-east, 2 m up -> asset Z, Y


def test_transform_yaw_ninety_means_plant_north_is_cloud_east():
    t = CloudTransform(origin=(0.0, 0.0, 0.0), yaw_deg=90)
    out = cloud_to_asset(np.array([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0]]), t)
    assert out[0] == pytest.approx([1, 0, 0], abs=1e-12)
    assert out[1] == pytest.approx([0, 0, 1], abs=1e-12)


@pytest.mark.parametrize(
    "p,expected",
    [
        ([0.2, 0.2, 1.0], [0.2, 0.2, 0.0]),  # face interior
        ([-1.0, -1.0, 0.0], [0.0, 0.0, 0.0]),  # vertex a
        ([2.0, -1.0, 0.0], [1.0, 0.0, 0.0]),  # vertex b
        ([0.5, -1.0, 0.0], [0.5, 0.0, 0.0]),  # edge ab
        ([1.0, 1.0, 0.0], [0.5, 0.5, 0.0]),  # edge bc
        ([-1.0, 0.5, 0.0], [0.0, 0.5, 0.0]),  # edge ac
    ],
)
def test_closest_point_regions(p, expected):
    a, b, c = np.array([[0, 0, 0.0]]), np.array([[1, 0, 0.0]]), np.array([[0, 1, 0.0]])
    got = closest_points(np.array([p], float), a, b, c)
    assert got[0] == pytest.approx(expected)


def ring_points(radius, n=4000, y0=0.5, y1=2.5, seed=0):
    rng = np.random.default_rng(seed)
    a = rng.uniform(0, 2 * np.pi, n)
    y = rng.uniform(y0, y1, n)
    return np.column_stack([radius * np.cos(a), y, radius * np.sin(a)])


def tube(r_out, h=3.0):
    m = trimesh.creation.annulus(r_min=r_out - 0.01, r_max=r_out, height=h, sections=256)
    m.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    m.apply_translation([0, h / 2, 0])
    return m


def test_offset_cloud_reports_the_offset():
    result = compare({"shell": tube(2.0)}, ring_points(2.010))
    shell = result.parts[0]
    assert shell.id == "shell"
    assert shell.median_mm == pytest.approx(10.0, abs=1.0)
    assert result.inlier_share == pytest.approx(1.0)


def test_points_are_attributed_to_the_nearest_part_and_outliers_dropped():
    inner = tube(1.0)
    pts = np.vstack([ring_points(2.005, 1000), ring_points(1.003, 1000, seed=1), [[0.0, 50.0, 0.0]]])
    result = compare({"shell": tube(2.0), "pipe": inner}, pts)
    by = {p.id: p for p in result.parts}
    assert by["shell"].n == 1000 and by["pipe"].n == 1000
    assert by["pipe"].median_mm == pytest.approx(3.0, abs=1.0)
    assert result.inlier_share == pytest.approx(2000 / 2001)


def test_too_many_points_are_subsampled_deterministically():
    pts = ring_points(2.0, 50_000)
    a = compare({"shell": tube(2.0)}, pts, max_points=5_000)
    b = compare({"shell": tube(2.0)}, pts, max_points=5_000)
    assert a.points_used == 5_000
    assert a.as_dict() == b.as_dict()


def test_part_with_no_points_has_no_stats():
    result = compare({"shell": tube(2.0), "far": tube(0.2)}, ring_points(2.0, 500))
    far = next(p for p in result.parts if p.id == "far")
    assert far.n == 0 and far.median_mm is None


def test_degenerate_input_returns_an_empty_comparison():
    empty = compare({}, np.empty((0, 3)))
    assert empty.overall.n == 0 and empty.overall.median_mm is None
    assert empty.parts == [] and empty.inlier_share == 0.0 and empty.points_used == 0
    no_points = compare({"shell": tube(2.0)}, np.empty((0, 3)))
    assert [p.id for p in no_points.parts] == ["shell"] and no_points.parts[0].n == 0
    no_meshes = compare({}, ring_points(2.0, 10))
    assert no_meshes.overall.n == 0 and no_meshes.points_used == 10


@pytest.mark.parametrize(
    "bad, match",
    [
        (np.zeros((10, 4)), "3 columns"),
        (np.zeros(9), "3 columns"),
        (np.array([[0.0, 1.0, np.nan]]), "finite"),
        (np.array([[0.0, np.inf, 1.0]]), "finite"),
    ],
)
def test_bad_point_input_raises_a_clear_error(bad, match):
    with pytest.raises(ValueError, match=match):
        compare({"shell": tube(2.0)}, bad)
