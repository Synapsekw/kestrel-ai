"""The point-cloud test helpers themselves (F0): tiny LAS/LAZ files and the fake Potree octree."""

import json
import struct

import laspy
import numpy as np
import pytest
from pointclouds import (
    HIERARCHY_NODE,
    POINT_RECORD,
    default_points,
    make_las,
    read_fake_octree,
    read_header_bounds,
    write_fake_octree,
)


def test_make_las_writes_a_readable_las_12_with_rgb_and_the_crs(tmp_path):
    path = make_las(tmp_path / "a.las", 500)
    las = laspy.read(path)
    assert len(las.points) == 500
    assert str(las.header.version) == "1.2"
    assert las.header.point_format.id == 3
    assert las.header.parse_crs().to_epsg() == 32639
    assert int(np.asarray(las.red).max()) == 65535 and int(np.asarray(las.green).max()) == 65535


def test_make_las_writes_laz_that_laspy_reads_back(tmp_path):
    path = make_las(tmp_path / "a.laz", 300, compressed=True)
    assert path.read_bytes()[:4] == b"LASF"
    las = laspy.read(path)
    assert las.header.are_points_compressed
    assert len(las.points) == 300


def test_make_las_keeps_given_points_to_the_file_scale(tmp_path):
    pts = np.array([[553100.0, 2847300.0, -45.0], [553101.2345, 2847302.5, -40.25]])
    las = laspy.read(make_las(tmp_path / "p.las", 0, points=pts))
    got = np.column_stack([las.x, las.y, las.z])
    assert np.allclose(got, pts, atol=0.0005)


def test_make_las_without_crs_or_rgb(tmp_path):
    las = laspy.read(make_las(tmp_path / "n.las", 10, epsg=None, rgb=False, point_format=1))
    assert las.header.parse_crs() is None
    assert "red" not in set(las.point_format.dimension_names)


def test_make_las_14_point_format_6_carries_the_crs_as_wkt(tmp_path):
    las = laspy.read(make_las(tmp_path / "v14.las", 50, version="1.4", point_format=6, rgb=False))
    assert str(las.header.version) == "1.4"
    assert las.header.point_format.id == 6
    assert las.header.parse_crs().to_epsg() == 32639


@pytest.mark.parametrize("compressed", [False, True])
def test_header_shrink_leaves_a_point_outside_the_header_bounds(tmp_path, compressed):
    path = make_las(tmp_path / "s.laz", 200, compressed=compressed, header_shrink_mm=0.3)
    true_max_x = float(np.asarray(laspy.read(path).x).max())
    header_max_x = read_header_bounds(path)[3]
    assert true_max_x - header_max_x == pytest.approx(0.0003, abs=1e-9)
    assert laspy.open(path).header.maxs[0] == pytest.approx(header_max_x)


def test_fake_octree_has_the_potree_2_layout(tmp_path):
    pts = default_points(1000)
    out = write_fake_octree(pts, tmp_path / "octree")
    meta = json.loads((out / "metadata.json").read_text("utf-8"))
    assert meta["version"] == "2.0" and meta["encoding"] == "DEFAULT"
    assert meta["points"] == 1000
    assert meta["hierarchy"]["firstChunkSize"] == HIERARCHY_NODE
    assert meta["spacing"] > 0
    assert [a["name"] for a in meta["attributes"]] == ["position", "rgb"]
    box_min, box_max = np.asarray(meta["boundingBox"]["min"]), np.asarray(meta["boundingBox"]["max"])
    assert np.all(box_min <= pts.min(axis=0)) and np.all(box_max >= pts.max(axis=0))
    size = box_max - box_min
    assert size[0] == pytest.approx(size[1]) == pytest.approx(size[2])  # a cube
    hierarchy = (out / "hierarchy.bin").read_bytes()
    assert len(hierarchy) == HIERARCHY_NODE
    node_type, child_mask, count, offset, size_bytes = struct.unpack("<BBIqq", hierarchy)
    assert (node_type, child_mask, count, offset) == (1, 0, 1000, 0)
    assert size_bytes == (out / "octree.bin").stat().st_size == POINT_RECORD * 1000


def test_fake_octree_decodes_back_to_the_points_and_colours(tmp_path):
    pts = default_points(64, seed=3)
    rgb = np.tile(np.array([[1, 2, 3]], dtype=np.uint16), (64, 1))
    _, xyz, colours = read_fake_octree(write_fake_octree(pts, tmp_path / "o", rgb=rgb))
    assert np.allclose(xyz, pts, atol=0.0005)
    assert (colours == rgb).all()


def test_fake_octree_refuses_no_points(tmp_path):
    with pytest.raises(ValueError, match="at least one point"):
        write_fake_octree(np.zeros((0, 3)), tmp_path / "o")
