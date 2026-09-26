"""The acceptance tools (Task 19 runs them on the chimney): tested on tiny inputs."""

import csv
import importlib.util
import os
import time
from pathlib import Path

import laspy
import numpy as np
import pytest
import rasterio
from pointclouds import make_las

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ortho_keeps_the_highest_point_per_cell(tmp_path):
    ortho = _load("make_test_ortho")
    pts = np.array([[243500.01, 3178000.01, 1.0], [243500.02, 3178000.02, 5.0], [243500.26, 3178000.26, 2.0]])
    src = make_las(tmp_path / "c.las", 3, points=pts)
    las = laspy.read(src)
    las.red = np.array([10, 200, 30], dtype=np.uint16) * 257
    las.green = np.array([10, 20, 30], dtype=np.uint16) * 257
    las.blue = np.array([10, 20, 30], dtype=np.uint16) * 257
    las.write(src)
    w, h = ortho.rasterise(src, tmp_path / "o.tif", 0.05)
    with rasterio.open(tmp_path / "o.tif") as ds:
        assert (ds.width, ds.height) == (w, h) and ds.crs.to_epsg() == 32639
        assert ds.transform.a == pytest.approx(0.05) and ds.transform.e == pytest.approx(-0.05)
        row, col = ds.index(243500.015, 3178000.015)
        assert tuple(ds.read()[:, row, col]) == (200, 20, 20)  # z 5 beats z 1 in the same cell


def test_check_picks_finds_real_points(tmp_path):
    picks_mod = _load("check_picks")
    pts = np.array([[243500.0, 3178000.0, 1.0], [243510.0, 3178010.0, 5.0]])
    src = make_las(tmp_path / "c.las", 2, points=pts)
    d = picks_mod.nearest_distances(src, [(243510.0, 3178010.0, 5.0), (243500.0, 3178000.0, 1.5)])
    assert d[0] == pytest.approx(0, abs=1e-6) and d[1] == pytest.approx(0.5, abs=1e-6)


def test_check_picks_reads_point_rows_from_the_export_csv(tmp_path):
    picks_mod = _load("check_picks")
    rows = tmp_path / "m.csv"
    with rows.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "kind", "note", "x1", "y1", "z1", "u1", "x2", "y2", "z2", "u2"])
        w.writerow(["a", "Point 1", "point", "", "1", "2", "3", "0.01", "", "", "", ""])
        w.writerow(["b", "Distance 1", "distance", "", "1", "2", "3", "0.01", "4", "5", "6", "0.01"])
    assert picks_mod.point_rows(rows) == [(1.0, 2.0, 3.0)]


def test_tiling_makes_nine_offset_copies(tmp_path):
    tiled = _load("make_tiled_cloud")
    src = make_las(tmp_path / "c.las", 1_000)
    n = tiled.tile(src, tmp_path / "t.las", gap=50.0)
    assert n == 9_000
    with laspy.open(src) as a, laspy.open(tmp_path / "t.las") as b:
        ext = a.header.maxs - a.header.mins
        assert b.header.point_count == 9_000
        assert b.header.maxs[0] - b.header.mins[0] == pytest.approx(3 * ext[0] + 2 * 50.0, abs=0.01)
        assert b.header.parse_crs().to_epsg() == 32639


def test_tree_rss_and_peak_sampler():
    acc = _load("pointcloud_acceptance")
    assert acc.tree_rss(os.getpid()) > 10_000_000
    sampler = acc.PeakSampler(os.getpid(), interval=0.02)
    sampler.start()
    time.sleep(0.1)
    peak = sampler.stop()
    assert peak >= acc.tree_rss(os.getpid()) * 0.5


def test_converter_rss_is_zero_without_a_converter():
    acc = _load("pointcloud_acceptance")
    assert acc.converter_rss(os.getpid()) == 0
