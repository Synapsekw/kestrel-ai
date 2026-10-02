"""Cloud->asset transform, point-triangle distance and per-part comparison (spec §7.3)."""

import numpy as np
import pytest

from app.asset_models.compare import CloudTransform, closest_points, cloud_to_asset


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
