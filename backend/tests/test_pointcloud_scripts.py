"""The acceptance tools (Task 19 runs them on the chimney): tested on tiny inputs."""

import csv
import hashlib
import importlib.util
import io
import json as _json
import math
import os
import time
from pathlib import Path

import httpx
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


# ---- C-G (clouds evidence): the workspace scenarios -----------------------------------------------


def test_tilted_patch_is_three_square_metres_on_a_60_degree_plane():
    acc = _load("pointcloud_acceptance")
    pts, corners = acc.tilted_patch()
    a, b, c, d = corners
    surface = np.linalg.norm(np.cross(b - a, d - a))
    normal = np.cross(b - a, d - a) / surface
    assert surface == pytest.approx(3.0, abs=1e-12)
    assert abs(np.cross(b - a, d - a)[2]) == pytest.approx(1.5, abs=1e-12)  # the plan area
    assert math.degrees(math.acos(abs(normal[2]))) == pytest.approx(60.0, abs=1e-9)
    assert np.max(np.abs((pts - a) @ normal)) < 1e-9  # every point on the plane
    assert len(pts) == 101 * 76


def test_leaning_cylinder_axis_leans_one_degree_to_grid_east():
    acc = _load("pointcloud_acceptance")
    pts = acc.leaning_cylinder()
    base = np.array(acc.CYL_BASE)
    for z_rel in (0.0, 10.0, 20.0):
        ring = pts[np.isclose(pts[:, 2], base[2] + z_rel)]
        centre = ring[:, :2].mean(axis=0)
        assert centre[0] - base[0] == pytest.approx(z_rel * math.tan(math.radians(1.0)), abs=1e-9)
        assert centre[1] - base[1] == pytest.approx(0.0, abs=1e-9)
        assert np.allclose(np.hypot(*(ring[:, :2] - centre).T), 1.0)


def test_ring_and_face_picks_without_noise_lie_on_the_cylinder():
    acc = _load("pointcloud_acceptance")
    rng = np.random.default_rng(7)
    picks = acc.ring_picks(rng, sigma=0.0)
    assert [p["group"] for p in picks] == [0] * 8 + [1] * 8
    base = np.array(acc.CYL_BASE)
    for p in picks:
        z_rel = p["z"] - base[2]
        cx = base[0] + z_rel * math.tan(math.radians(1.0))
        assert math.hypot(p["x"] - cx, p["y"] - base[1]) == pytest.approx(1.0, abs=1e-9)
    low, high = acc.face_picks(rng, sigma=0.0)
    lean = math.degrees(math.atan2(high["x"] - low["x"], high["z"] - low["z"]))
    assert lean == pytest.approx(1.0, abs=1e-9)
    assert high["y"] == pytest.approx(low["y"], abs=1e-12)


def test_write_shapes_las_holds_both_shapes_in_utm(tmp_path):
    acc = _load("pointcloud_acceptance")
    path = acc.write_shapes_las(tmp_path / "shapes.las")
    las = laspy.read(path)
    assert len(las.points) == len(acc.tilted_patch()[0]) + len(acc.leaning_cylinder())
    assert las.header.parse_crs().to_epsg() == 32639


def test_band_widths_measure_the_extent_per_height_bin():
    acc = _load("pointcloud_acceptance")
    s = np.array([1.0, 1.3, 1.1, 5.0, 5.2])
    z = np.array([10.01, 10.05, 10.09, 10.15, 10.19])
    rows = acc.band_widths(s, z, 10.0, 10.2)
    assert [round(r["z"], 2) for r in rows] == [10.05, 10.15]
    assert [round(r["width"], 6) for r in rows] == [0.3, 0.2]
    assert [r["n"] for r in rows] == [3, 2]


def _png(width: int, height: int) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (40, 80, 120)).save(buf, format="PNG")
    return buf.getvalue()


def test_setup_creates_types_project_cloud_and_photos(tmp_path):
    acc = _load("pointcloud_acceptance")
    seen: list[tuple[str, str, dict | None]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = _json.loads(req.content) if req.content else None
        seen.append((req.method, req.url.path, body))
        p = req.url.path
        if p.endswith("/catalogue/types"):
            return httpx.Response(201, json={"id": f"t-{body['name']}"})
        if p.endswith("/api/v1/projects"):
            return httpx.Response(201, json={"id": "p1"})
        if p.endswith("/projects/p1/pointclouds"):
            return httpx.Response(202, json={"cloud": {"id": "c1"}, "job": {"id": "j1"}})
        if p.endswith("/projects/p1/sources"):
            return httpx.Response(202, json={"source": {"id": "s1"}, "job": {"id": "j2"}})
        if "/jobs/" in p:
            return httpx.Response(200, json={"state": "succeeded", "error": None})
        return httpx.Response(404)

    args = type(
        "A",
        (),
        {
            "base": "http://x",
            "token": "t",
            "project_folder": str(tmp_path / "proj"),
            "source": "C:/c.las",
            "photos": "D:/flight",
            "backend_pid": None,
            "transport": httpx.MockTransport(handler),
        },
    )()
    out = acc.run_setup(args)
    assert out == {
        **out,
        "project_id": "p1",
        "cloud_id": "c1",
        "source_id": "s1",
        "crack_type_id": "t-Crack",
        "import_state": "succeeded",
        "photos_state": "succeeded",
    }
    types = [b for m, p, b in seen if p.endswith("/catalogue/types")]
    assert {"name": "Crack", "colour": "#ef4444", "kind": "defect"} in types
    project = next(b for m, p, b in seen if p.endswith("/api/v1/projects"))
    assert set(project["type_ids"]) == {"t-excavator", "t-Crack"}
    assert ("POST", "/api/v1/projects/p1/sources", {"folder": "D:/flight"}) in seen


def test_views_compares_bytes_sha_and_size():
    acc = _load("pointcloud_acceptance")
    good, small = _png(1600, 1000), _png(800, 500)
    items = [
        {
            "subject_kind": "finding",
            "subject_id": "f1",
            "sha256": hashlib.sha256(good).hexdigest(),
            "width": 1600,
            "height": 1000,
            "stale": False,
            "render": {"complete": True, "edl": True},
        },
        {
            "subject_kind": "cloud_measurement",
            "subject_id": "m1",
            "sha256": "0" * 64,
            "width": 800,
            "height": 500,
            "stale": True,
            "render": {"complete": False, "edl": True},
        },
    ]

    def handler(req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if p.endswith("/views"):
            return httpx.Response(200, json={"items": items})
        if p.endswith("/findings/f1/view3d"):
            return httpx.Response(200, content=good, headers={"content-type": "image/png"})
        if p.endswith("/measurements/m1/view3d"):
            return httpx.Response(200, content=small, headers={"content-type": "image/png"})
        return httpx.Response(404)

    args = type(
        "A",
        (),
        {
            "base": "http://x",
            "token": "t",
            "project_id": "p1",
            "cloud_id": "c1",
            "transport": httpx.MockTransport(handler),
        },
    )()
    out = acc.run_views(args)
    assert out["count"] == 2 and out["stale"] == 1 and out["incomplete"] == 1
    by = {r["subject_id"]: r for r in out["rows"]}
    assert by["f1"]["ok"] is True
    assert by["m1"]["ok"] is False and by["m1"]["size"] == [800, 500] and by["m1"]["sha_ok"] is False


def test_token_comes_from_the_environment_when_no_flag_is_given():
    # C-G Task 9 fix round 1 (m6): the launcher passes the token through the environment, so it is
    # never on a process command line; --token keeps working for manual runs.
    acc = _load("pointcloud_acceptance")
    assert acc.resolve_token("cli", {"KESTREL_TOKEN": "k", "APP_TOKEN": "a"}) == "cli"
    assert acc.resolve_token(None, {"KESTREL_TOKEN": "k", "APP_TOKEN": "a"}) == "k"
    assert acc.resolve_token(None, {"APP_TOKEN": "a"}) == "a"
    with pytest.raises(SystemExit, match="token"):
        acc.resolve_token(None, {})
