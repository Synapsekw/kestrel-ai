# backend/tests/test_synthetic_tower.py
"""The shared synthetic tower generator (backend/tests/fixtures/synthetic_tower.py): a port of the kit's
examples/synthetic-tower that J2 to J5 and the close-out build on. No customer data (spec A10)."""

import math

import pytest
import trimesh
from fixtures.synthetic_tower import ALT0, LAT0, LON0, PHOTO_H, PHOTO_W, make_tower
from PIL import Image

from app.asset_review.derive import derive
from app.asset_review.profiles import resolve
from app.datasets.prepare import read_camera, read_exif

COUNTS = {"D1": 7, "D2": 9, "D3": 8, "D4": 6, "D5": 8, "D6": 8}


def test_it_writes_a_glb_and_32_geotagged_photos(tmp_path):
    t = make_tower(tmp_path)
    assert t.glb_path == tmp_path / "model.glb" and t.glb_path.stat().st_size > 100_000
    assert t.photos_dir == tmp_path / "photos"
    names = sorted(p.name for p in t.photos_dir.iterdir())
    assert names == [f"DJI_{i:04d}.JPG" for i in range(1, 33)]
    assert [p["name"] for p in t.poses] == names
    assert t.profile_id == "telecom_tower" and t.image_size == (PHOTO_W, PHOTO_H) == (1600, 1067)


def test_the_glb_is_the_kit_tower(tmp_path):
    scene = trimesh.load(make_tower(tmp_path, photos=False).glb_path, force="scene")
    assert len(scene.graph.nodes_geometry) == 253
    lo, hi = scene.bounds
    assert lo.tolist() == pytest.approx([-6.0, -0.3, -6.0], abs=1e-6)
    assert hi.tolist() == pytest.approx([6.0, 42.0476, 6.0], abs=1e-3)
    assert "Leg_000" in scene.graph.nodes_geometry


def test_it_is_deterministic(tmp_path):
    a, b = make_tower(tmp_path / "a"), make_tower(tmp_path / "b")
    assert a.glb_path.read_bytes() == b.glb_path.read_bytes()
    assert (a.photos_dir / "DJI_0010.JPG").read_bytes() == (b.photos_dir / "DJI_0010.JPG").read_bytes()
    assert a.truth == b.truth and a.poses == b.poses


def test_photos_false_writes_no_jpegs(tmp_path):
    t = make_tower(tmp_path, photos=False)
    assert t.photos_dir is None and not (tmp_path / "photos").exists()


def test_the_frame(tmp_path):
    f = make_tower(tmp_path, photos=False).frame
    assert (
        (f.origin.lat, f.origin.lon, f.origin.ground_alt_m) == (LAT0, LON0, ALT0) == (24.4539, 54.3773, 5.0)
    )
    assert (f.height_m, f.north_offset_deg, f.line_azimuth_deg) == (42.0, 0.0, None)
    assert f.levels == [30.0, 36.0] and f.silhouette[0] == (0.0, 4.243)


def test_the_truth_is_the_kits_six_defects(tmp_path):
    truth = make_tower(tmp_path, photos=False).truth
    assert [(d.id, d.cls, d.severity) for d in truth] == [
        ("D1", "corrosion", 2),
        ("D2", "fastener", 3),
        ("D3", "foreign", 1),
        ("D4", "antenna", 2),
        ("D5", "coating", 1),
        ("D6", "cable", 2),
    ]
    centres = {d.id: d.center for d in truth}
    assert centres["D1"] == pytest.approx((2.37071, 12.0, 2.37071), abs=1e-5)
    assert centres["D2"] == pytest.approx((-1.84571, 21.0, -1.84571), abs=1e-5)
    assert centres["D3"] == pytest.approx((0.5, 30.35, -0.375))
    assert centres["D4"] == pytest.approx((-1.39413, 39.2, 0.28529), abs=1e-5)
    assert centres["D5"] == pytest.approx((2.73485, 6.0, -2.73485), abs=1e-5)
    assert centres["D6"] == pytest.approx((0.965, 27.6, 1.095))


def test_the_sightings_follow_detect_truth(tmp_path):
    truth = make_tower(tmp_path, photos=False).truth
    assert {d.id: len(d.sightings) for d in truth} == COUNTS
    assert sum(COUNTS.values()) == 46
    first = truth[0].sightings[0]
    assert first.image_name == "DJI_0009.JPG"
    assert first.box == pytest.approx((611.0, 867.5, 77.2, 77.2))
    for d in truth:
        for s in d.sightings:
            x, y, w, h = s.box
            assert (
                0 <= x and 0 <= y and x + w <= PHOTO_W + 1e-6 and y + h <= PHOTO_H + 1e-6 and w > 0 and h > 0
            )


def test_truth_zone_and_side_follow_the_derivation_rules(tmp_path):
    t = make_tower(tmp_path, photos=False)
    review = resolve(t.profile_id, t.frame.height_m)
    for d in t.truth:
        got = derive(d.center, None, review, t.frame)
        assert (got.zone, got.side) == (d.zone, d.side), d.id
    assert [(d.zone, d.side) for d in t.truth] == [
        ("body", "NE"),
        ("body", "SW"),
        ("body", "NW"),
        ("antenna", "S"),
        ("body", "NW"),
        ("body", "NE"),
    ]


def test_the_poses_are_the_kits_four_rings(tmp_path):
    poses = make_tower(tmp_path, photos=False).poses
    assert len(poses) == 32
    assert sorted({p["position"][1] for p in poses}) == [7.0, 17.0, 27.0, 38.0]
    assert [p["roll"] for p in poses].count(3.0) == 5  # k % 7 == 3
    p = poses[3]
    assert p["yaw"] == pytest.approx(336.0) and p["pitch"] == pytest.approx(-7.594643368591445)
    assert p["hfov"] == pytest.approx(2 * math.degrees(math.atan(36 / 62)))
    assert math.hypot(p["target"][0], p["target"][2]) < 1e-9  # aimed at the axis


def test_the_photos_read_like_the_importer_reads_them(tmp_path):
    t = make_tower(tmp_path)
    pose = t.poses[3]
    with Image.open(t.photos_dir / "DJI_0004.JPG") as im:
        assert im.size == (1600, 1067)
        capture, lat, lon, alt = read_exif(im)
        cam = read_camera(im, original=True)
    assert capture.isoformat() == "2026-09-20T09:10:21+00:00"
    assert lat == pytest.approx(pose["latitude"], abs=1e-7)
    assert lon == pytest.approx(pose["longitude"], abs=1e-7)
    assert alt == pytest.approx(12.0) == pose["altitude"]
    assert (cam.gimbal_yaw, cam.gimbal_pitch, cam.gimbal_roll, cam.rel_alt) == (-24.0, -7.59, 3.0, 7.0)
    assert cam.focal_mm == 4.5 and cam.sensor_w_mm == pytest.approx(36 * 4.5 / 31)
    assert (cam.orig_w, cam.orig_h) == (1600, 1067)
