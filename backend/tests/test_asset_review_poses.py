# backend/tests/test_asset_review_poses.py
"""pose_from_exif against kit cameras.py pose() (spec §6.2, §12): hand-computed goldens and a
seeded parity run against a verbatim copy of the kit formula."""

import math
import random

import pytest

from app.asset_review.frame import Frame, Origin, true_to_plant
from app.asset_review.poses import EXIF_ACCURACY_M, PoseIn, fov_deg, has_gps, pose_from_exif
from app.db.models import Image

LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
# 0.0001 deg of latitude is radians(0.0001) * 6378137 = 11.131949 m; of longitude at LAT0 it is that
# times cos(24.4539 deg) = 10.133430 m.
DN, DE = 11.131949079327358, 10.13342997


def frame(height=42.0, offset=0.0, origin=True):
    return Frame(
        origin=Origin(lat=LAT0, lon=LON0, ground_alt_m=ALT0) if origin else None,
        north_offset_deg=offset,
        height_m=height,
        datum_label="Ground",
        datum_note="",
        line_azimuth_deg=None,
        silhouette=[],
        levels=[],
        presets=[],
    )


def image(**cols):
    base = {"width": 5472, "height": 3648, "path": "images/x.jpg", "source_id": "s"}
    return Image(**{**base, **cols})


def close(got, want, tol=1e-4):
    return all(abs(a - b) <= tol for a, b in zip(got, want, strict=True))


# ----- golden: hand-computed


def test_gimbal_pose_golden():
    # 0.0001 deg north of the origin, 20 m above the datum, yaw 180 (south, toward the axis), pitch -30
    # d = (cos -30 cos 180, sin -30, cos -30 sin 180) = (-0.866025, -0.5, 0)
    # t = -(x d0) / (d0^2 + d2^2) = 11.131949 * 0.866025 / 0.75 = 12.854166
    # target = P + d t = (0, 20 - 6.427083, 0) = (0, 13.5729, 0)
    # FOV: f 8.8 mm, 13.2 mm sensor: 2 atan(13.2 / 17.6) = 73.7398; vfov 2 atan(0.75 * 3648/5472) = 53.1301
    p = pose_from_exif(
        image(
            lat=LAT0 + 0.0001,
            lon=LON0,
            alt=25.0,
            gimbal_yaw=180.0,
            gimbal_pitch=-30.0,
            focal_mm=8.8,
            sensor_w_mm=13.2,
        ),
        frame(),
    )
    assert isinstance(p, PoseIn) and p.source == "exif_gimbal" and p.accuracy_m == EXIF_ACCURACY_M
    assert p.position == (11.1319, 20.0, 0.0)
    assert close(p.target, (0.0, 13.573, 0.0))
    assert p.up == (0.0, 1.0, 0.0)
    assert (p.hfov_deg, p.vfov_deg) == (73.7398, 53.1301)


def test_roll_rotates_up_about_the_view_axis():
    # Rodrigues, k = d = (-0.866025, -0.5, 0), v = (0, 1, 0), roll 10: k.v = -0.5, k x v = (0, 0, -0.866025)
    # up = v cos + (k x v) sin + k (k.v)(1 - cos)
    #    = (0, 0.984808, 0) + (0, 0, -0.150384) + (0.006578, 0.003798, 0) = (0.00658, 0.98861, -0.15038)
    p = pose_from_exif(
        image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0, gimbal_roll=10.0),
        frame(),
    )
    assert p.up == (0.00658, 0.98861, -0.15038)
    small = pose_from_exif(
        image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0, gimbal_roll=0.4),
        frame(),
    )
    assert small.up == (0.0, 1.0, 0.0)  # the kit ignores |roll| <= 0.5


def test_flight_yaw_is_the_yaw_fallback_and_pitch_defaults_to_level():
    # 0.0001 deg east: z = 10.1334; flight yaw 270 (west), no pitch -> d = (0, 0, -1), target on the axis
    p = pose_from_exif(
        image(lat=LAT0, lon=LON0 + 0.0001, alt=15.0, flight_yaw=270.0, width=4000, height=3000), frame()
    )
    assert p.source == "exif_gimbal"
    assert p.position == (0.0, 10.0, round(DE, 4)) and close(p.target, (0.0, 10.0, 0.0))
    # no lens at all: 70 deg across the long side; vfov 2 atan(tan 35 * 3000/4000) = 55.4129
    assert (p.hfov_deg, p.vfov_deg) == (70.0, 55.4129)


def test_missing_altitude_puts_the_camera_on_the_datum():
    # the kit's alt0 fallback: y = 0; the ray then runs down to y = -6.427 at the axis
    p = pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, gimbal_yaw=180.0, gimbal_pitch=-30.0), frame())
    assert p.position == (11.1319, 0.0, 0.0) and close(p.target, (0.0, -6.427, 0.0))


def test_focal_px_is_the_second_fov_rule():
    # 3000 px on a 4000 px long side: 2 atan(4000 / 6000) = 67.3801; vfov 2 atan(0.666667 * 0.75) = 53.1301
    assert fov_deg(image(width=4000, height=3000, focal_px=3000.0, orig_w=4000, orig_h=3000)) == (
        67.3801,
        53.1301,
    )
    # focal_mm + sensor_w_mm wins over focal_px, as the kit's 35 mm rule wins over everything
    assert (
        fov_deg(
            image(
                width=4000,
                height=3000,
                focal_mm=8.8,
                sensor_w_mm=13.2,
                focal_px=3000.0,
                orig_w=4000,
                orig_h=3000,
            )
        )[0]
        == 73.7398
    )


def test_a_portrait_photo_gets_the_long_angle_vertically():
    assert fov_deg(image(width=3648, height=5472, focal_mm=8.8, sensor_w_mm=13.2)) == (53.1301, 73.7398)


def test_no_yaw_aims_at_the_axis_at_camera_height():
    # aim at (0, clamp(y, 0, H), 0): y = 20 is inside [0, 42], so the target is (0, 20, 0)
    p = pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, width=4000, height=3000), frame())
    assert p.source == "exif_axis_aim"
    assert p.position == (11.1319, 20.0, 0.0) and close(p.target, (0.0, 20.0, 0.0))


def test_no_yaw_above_the_asset_aims_at_its_top():
    # y = 50 is above H = 42: d = (-11.1319, -8, 0) normalised; the axis point is (0, 42, 0)
    p = pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, alt=55.0, width=4000, height=3000), frame())
    assert close(p.target, (0.0, 42.0, 0.0))


def test_plant_north_offset_turns_position_and_yaw():
    # plant north is true east (offset 90): a photo 0.0001 deg east is 10.1334 m plant-north; true
    # yaw 270 (west) is plant yaw 180, so it looks back down -X at the axis
    p = pose_from_exif(
        image(
            lat=LAT0, lon=LON0 + 0.0001, alt=15.0, gimbal_yaw=270.0, gimbal_pitch=0.0, width=4000, height=3000
        ),
        frame(offset=90.0),
    )
    assert close(p.position, (round(DE, 4), 10.0, 0.0)) and close(p.target, (0.0, 10.0, 0.0))
    x, z = true_to_plant(1.0, 0.0, 90.0)  # P1's helper: true north is plant -Z when plant north is true east
    assert abs(x) < 1e-12 and z == pytest.approx(-1.0)


def test_no_pose_without_gps_origin_or_direction():
    assert pose_from_exif(image(lat=None, lon=LON0, alt=25.0, gimbal_yaw=0.0), frame()) is None
    assert not has_gps(image(lat=LAT0, lon=None)) and has_gps(image(lat=LAT0, lon=LON0))
    assert (
        pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=0.0), frame(origin=False))
        is None
    )
    # no yaw and standing on the axis at a height inside the asset: the aim vector is zero
    # (the kit divides by zero here)
    assert pose_from_exif(image(lat=LAT0, lon=LON0, alt=25.0), frame()) is None


def test_nan_columns_are_treated_as_missing():
    p = pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=float("nan")), frame())
    assert p.source == "exif_axis_aim"


# ----- parity: a verbatim copy of kit cameras.py pose() (asset-inspection-kit/kit/cameras.py)


def _kit_pose(meta, origin, sensor_w=None, asset_height=None):
    lat0, lon0, alt0 = origin
    Re = 6378137.0  # noqa: N806
    x = math.radians(meta["latitude"] - lat0) * Re
    z = math.radians(meta["longitude"] - lon0) * Re * math.cos(math.radians(lat0))
    alt = meta.get("AbsoluteAltitude", meta.get("altitude", alt0))
    y = alt - alt0
    W, H = meta["width"], meta["height"]  # noqa: N806
    if meta.get("focal35"):
        hf = 2 * math.degrees(math.atan(36 / (2 * meta["focal35"])))
    elif meta.get("focal") and sensor_w:
        hf = 2 * math.degrees(math.atan(sensor_w / (2 * meta["focal"])))
    else:
        hf = 70.0
    vf = 2 * math.degrees(math.atan(math.tan(math.radians(hf / 2)) * H / W))
    yaw = meta.get("GimbalYawDegree", meta.get("FlightYawDegree", meta.get("img_direction")))
    pitch = meta.get("GimbalPitchDegree")
    P = [x, y, z]  # noqa: N806
    if yaw is None:
        ty = min(max(y, 0), asset_height or y)
        d = [-x, ty - y, -z]
    else:
        pr = math.radians(pitch if pitch is not None else 0)
        yr = math.radians(yaw)
        d = [math.cos(pr) * math.cos(yr), math.sin(pr), math.cos(pr) * math.sin(yr)]
    n = math.sqrt(sum(v * v for v in d))
    d = [v / n for v in d]
    hz = d[0] ** 2 + d[2] ** 2
    t = -(x * d[0] + z * d[2]) / hz if hz > 1e-6 else math.hypot(x, z) or 10
    if t <= 0:
        t = math.sqrt(x * x + z * z) or 10
    T = [P[i] + d[i] * t for i in range(3)]  # noqa: N806
    up = [0, 1, 0]
    roll = meta.get("GimbalRollDegree")
    if roll and abs(roll) > 0.5:
        r = math.radians(roll)
        c, s = math.cos(r), math.sin(r)
        k = d
        v = up
        kv = sum(k[i] * v[i] for i in range(3))
        cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]
        up = [v[i] * c + cr[i] * s + k[i] * kv * (1 - c) for i in range(3)]
    return {
        "position": [round(v, 4) for v in P],
        "target": [round(v, 4) for v in T],
        "up": [round(v, 5) for v in up],
        "hfov": round(hf, 4),
        "vfov": round(vf, 4),
    }


def test_parity_with_the_kit_formula_on_500_seeded_records():
    rng = random.Random(1)
    for _ in range(500):
        cols = {
            "lat": LAT0 + rng.uniform(-3e-4, 3e-4),
            "lon": LON0 + rng.uniform(-3e-4, 3e-4),
            "alt": ALT0 + rng.uniform(0, 80),
            "width": 4000,
            "height": 3000,
        }
        meta = {
            "latitude": cols["lat"],
            "longitude": cols["lon"],
            "altitude": cols["alt"],
            "width": 4000,
            "height": 3000,
        }
        if rng.random() < 0.8:
            cols["gimbal_yaw"] = meta["GimbalYawDegree"] = rng.uniform(-180, 360)
        if rng.random() < 0.9:
            cols["gimbal_pitch"] = meta["GimbalPitchDegree"] = rng.uniform(-90, 10)
        if rng.random() < 0.5:
            cols["gimbal_roll"] = meta["GimbalRollDegree"] = rng.uniform(-20, 20)
        sensor_w = None
        if rng.random() < 0.7:
            cols["focal_mm"], cols["sensor_w_mm"], meta["focal"], sensor_w = 8.8, 13.2, 8.8, 13.2
        kit = _kit_pose(meta, (LAT0, LON0, ALT0), sensor_w=sensor_w, asset_height=42.0)
        p = pose_from_exif(image(**cols), frame())
        assert p is not None
        assert list(p.position) == kit["position"] and list(p.target) == kit["target"]
        assert list(p.up) == kit["up"] and (p.hfov_deg, p.vfov_deg) == (kit["hfov"], kit["vfov"])


# ----- junk metadata never raises (final review I1, M1)

_JUNK_FOV_ROWS = [
    dict(focal_mm=1e-6, sensor_w_mm=36.0),
    dict(focal_mm=1e9, sensor_w_mm=36.0),
    dict(focal_mm=None, focal_px=1e-4, orig_w=5472, orig_h=3648),
    dict(focal_mm=None, focal_px=1e12, orig_w=5472, orig_h=3648),
    dict(width=0, height=0),
    dict(width=0),
    dict(height=0),
    dict(width=None, height=None),
]


@pytest.mark.parametrize("cols", _JUNK_FOV_ROWS)
def test_junk_lens_or_size_still_gives_a_valid_pose(cols):
    row = dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, **cols)
    pose = pose_from_exif(image(**row), frame())
    assert pose is not None
    assert 0 < pose.hfov_deg < 180 and 0 < pose.vfov_deg < 180


def test_insane_lens_rule_falls_through_to_the_next_rule():
    # focal_mm rule gives ~180 degrees: skipped; focal_px rule (long side 5472, f 3000 px) is used
    hf, _ = fov_deg(image(focal_mm=1e-6, sensor_w_mm=36.0, focal_px=3000.0, orig_w=5472, orig_h=3648))
    assert abs(hf - 2 * math.degrees(math.atan(5472 / 6000))) < 1e-3
    assert fov_deg(image(focal_mm=1e-6, sensor_w_mm=36.0))[0] == 70.0


@pytest.mark.parametrize("lat,lon", [(4e9, LON0), (LAT0, 181.0), (-90.5, LON0), (LAT0, -1e6)])
def test_out_of_range_coordinates_are_no_gps(lat, lon):
    img = image(lat=lat, lon=lon, alt=25.0, gimbal_yaw=180.0)
    assert not has_gps(img)
    assert pose_from_exif(img, frame()) is None
