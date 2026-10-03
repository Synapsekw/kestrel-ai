# Asset findings J2: photo poses from EXIF (`asset_pose`) and the poses API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every photo with GPS gets a pose in an asset model's frame: where it was taken from, where it looks, its roll and its field of view. The pose is computed from the camera columns Kestrel already stores on `image` (migration 0011), with the kit's `cameras.py` `pose()` formula. The poses are listed in pages for the cameras layer, and the operator can set one by hand. Photos with no GPS are skipped and reported. Photos with no yaw aim at the asset axis. Kit and manual poses are never overwritten.

**Architecture:**
- **`app/asset_review/poses.py`** holds `PoseIn` and `pose_from_exif(image, frame)`. It is pure: it reads only the ORM row's columns and never opens a file.
- **`app/asset_review/pose_job.py`** holds the `asset_pose` job. It walks the images in scope in keyset pages of 500 and upserts `image_pose` rows. It skips rows whose source is `kit` or `manual`, and returns a result that lists the skipped photos and why.
- **`app/asset_review/pose_schemas.py`** and **`routes_poses.py`** serve three routes:
  - `GET /asset-models/{assetModelId}/poses`: keyset by `image_id`, at most 2,000 rows a page, with an optional `sequence` filter and the photo's review `outcome`.
  - `POST .../poses/estimate`: queues the job; answers 422 when the frame has no origin and 409 while a pose job is live.
  - `PUT .../poses/{imageId}`: a manual pose.

**Tech Stack:** FastAPI, SQLAlchemy, pydantic v2, pytest. No new dependency.

**Spec sections covered:** §5.3 (`image_pose`); §6.2 (`asset_pose`, both modes); §8 (`GET .../poses`, `POST .../poses/estimate`, `PUT .../poses/{image_id}`); §11 (bounded reads, paged poses list); §12 "Poses: against kit `cameras.py` on hand-written EXIF records (yaw, pitch, roll, no-yaw axis aim, FOV fallbacks)". Review Focus 2 (the pose half).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs (merged to `main` first):**
- **C0:** the contract and the three stubs in `backend/app/asset_review/stubs.py`.
- **D1:** the ORM classes `ImagePose`, `ImageReview` and `AssetModel.frame`.
- **P1:** `app.asset_review.frame.Frame`, `Origin` and `true_to_plant`, and `backend/tests/fixtures/synthetic_tower.py` (`make_tower(tmp_path, photos=True)` writes 32 JPEGs with EXIF GPS, `FocalLength`, `FocalLengthIn35mmFilm` and DJI XMP gimbal angles).

J2 does not need J1. Its tests set `asset_model.frame` directly through the session.

**Worktree:** `scripts\start-task.ps1 -Name af-j2`

**Budget:**
- **Background job:** `asset_pose`. It is column-only: one page of 500 `image` rows and their `image_pose` rows in memory at a time, and no image file is ever opened. It checks for cancellation per photo and reports progress per page; `ctx.progress` throttles its own database writes to 0.25 s.
- **Bounded reads:**
  - the poses list is keyset-paged, at most 2,000 rows;
  - the `image_ids` scope is chunked by 500 for `IN` queries;
  - the job result lists at most 200 skipped photos (`skipped_images`) plus a total count (`skipped`).

**Execution DAG:**
- Task 1 (`pose_from_exif`, pure) comes first.
- Task 2 (job) needs Task 1.
- Task 3 (API) needs Task 2, because it queues the job and its tests run it.
- Task 4 is the gate.
- **Critical path:** Task 1, Task 2, Task 3, Task 4. The unit is small and sequential by nature: each layer is the next one's input.

`$PY` below is `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. Every backend command runs from `backend/` in the worktree.

### What Kestrel stores, against what the kit read

| Kit `pose()` input | Kestrel source | Gap, and how J2 handles it |
| --- | --- | --- |
| `latitude`, `longitude` (EXIF GPS) | `image.lat`, `image.lon` | none |
| `AbsoluteAltitude` (XMP), else GPS `altitude` | `image.alt` (EXIF GPSAltitude) | XMP `AbsoluteAltitude` is not stored. On DJI frames the two agree in practice. With no altitude the kit puts the camera on the datum (y = 0); J2 does the same and counts those photos in `no_altitude`. |
| `GimbalYawDegree`, else `FlightYawDegree`, else EXIF `GPSImgDirection` | `image.gimbal_yaw`, then `image.flight_yaw` | `GPSImgDirection` is not stored, so a photo with only that tag aims at the axis. |
| `GimbalPitchDegree`, `GimbalRollDegree` | `image.gimbal_pitch`, `image.gimbal_roll` | none |
| `FocalLengthIn35mmFilm` | not stored | Import turns it into `sensor_w_mm = 36 * focal_mm / focal35` when the focal-plane tags are missing (`app/library/gsd.py` `intrinsics_from_exif`). So `focal_mm` plus `sensor_w_mm` gives the kit's first rule exactly: 2·atan(sensor_w / 2f) = 2·atan(36 / 2·f35). |
| `focal` plus `--sensor-w` | `image.focal_mm`, `image.sensor_w_mm` | none |
| (none) | `image.focal_px`, `orig_w`, `orig_h` (XMP CalibratedFocalLength) | An extra fallback before 70 degrees, which the kit did not have. |
| 70 degrees | 70 degrees | none |
| `width`, `height` (raw file) | `image.width`, `image.height` (stored, upright) | The kit's angle spans the width. Kestrel stores portrait frames upright, so J2 applies the angle to the **long** side: on a landscape photo that is the kit's number exactly, and a portrait photo gets the narrow angle across its width. |
| model frame X = north | the asset frame X = **plant** north | The north offset and yaw are turned by `frame.north_offset_deg`, which J2 reads as the true bearing of plant north. At 0 the result is the kit's exactly. |

---

### Task 1: `pose_from_exif` (pure port of kit `cameras.py` `pose()`)

**Files:**
- Create: `backend/app/asset_review/poses.py`
- Test: `backend/tests/test_asset_review_poses.py`

**Interfaces:**
- Consumes:
  - `app.db.models.Image` (existing columns);
  - P1's `app.asset_review.frame.Frame` (`origin: Origin | None` with `lat`, `lon`, `ground_alt_m`; `north_offset_deg`; `height_m`) and `Origin`.
- Produces:
  - `PoseSource = Literal["kit", "exif_gimbal", "exif_axis_aim", "manual"]`
  - `PoseIn` (pydantic, frozen), with fields:
    - `position`, `target`, `up`: each a 3-tuple of floats;
    - `hfov_deg`, `vfov_deg`: in the open interval (0, 180);
    - `source: PoseSource`;
    - `accuracy_m: float | None`.
  - `pose_from_exif(image: Image, frame: Frame) -> PoseIn | None`. It returns None when there is no origin, no GPS, or no yaw with the camera on the axis.
  - `has_gps(image) -> bool`; `fov_deg(image) -> tuple[float, float]`.
  - Consumes P1's `app.asset_review.frame.true_to_plant(north_m, east_m, north_offset_deg) -> (x, z)` for the GPS offset (P1 Task 1 fixes `north_offset_deg` as the true bearing of plant north); J2 does not define its own.
  - Constants: `R_EARTH_M = 6378137.0`, `DEFAULT_LONG_FOV_DEG = 70.0`, `MIN_ROLL_DEG = 0.5`, `EXIF_ACCURACY_M = 3.0`.

- [ ] **Step 1: Write the failing tests**

The goldens below are hand-computed (the derivation is in each comment). The parity test runs a verbatim copy of the kit's `pose()` on 500 seeded random records, so any drift from the kit fails. The kit is the operator's own code and holds no customer data.

```python
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
    # FOV: f 8.8 mm on a 13.2 mm sensor: 2 atan(13.2 / 17.6) = 73.7398; vfov 2 atan(0.75 * 3648/5472) = 53.1301
    p = pose_from_exif(
        image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0, focal_mm=8.8, sensor_w_mm=13.2),
        frame(),
    )
    assert isinstance(p, PoseIn) and p.source == "exif_gimbal" and p.accuracy_m == EXIF_ACCURACY_M
    assert p.position == (11.1319, 20.0, 0.0)
    assert close(p.target, (0.0, 13.573, 0.0))
    assert p.up == (0.0, 1.0, 0.0)
    assert (p.hfov_deg, p.vfov_deg) == (73.7398, 53.1301)


def test_roll_rotates_up_about_the_view_axis():
    # Rodrigues with k = d = (-0.866025, -0.5, 0), v = (0, 1, 0), roll 10 deg: k.v = -0.5, k x v = (0, 0, -0.866025)
    # up = v cos + (k x v) sin + k (k.v)(1 - cos)
    #    = (0, 0.984808, 0) + (0, 0, -0.150384) + (0.006578, 0.003798, 0) = (0.00658, 0.98861, -0.15038)
    p = pose_from_exif(
        image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0, gimbal_roll=10.0),
        frame(),
    )
    assert p.up == (0.00658, 0.98861, -0.15038)
    small = pose_from_exif(
        image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0, gimbal_roll=0.4), frame()
    )
    assert small.up == (0.0, 1.0, 0.0)  # the kit ignores |roll| <= 0.5


def test_flight_yaw_is_the_yaw_fallback_and_pitch_defaults_to_level():
    # 0.0001 deg east: z = 10.1334; flight yaw 270 (west), no pitch -> d = (0, 0, -1), target on the axis
    p = pose_from_exif(image(lat=LAT0, lon=LON0 + 0.0001, alt=15.0, flight_yaw=270.0, width=4000, height=3000), frame())
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
    assert fov_deg(image(width=4000, height=3000, focal_px=3000.0, orig_w=4000, orig_h=3000)) == (67.3801, 53.1301)
    # focal_mm + sensor_w_mm wins over focal_px, as the kit's 35 mm rule wins over everything
    assert fov_deg(
        image(width=4000, height=3000, focal_mm=8.8, sensor_w_mm=13.2, focal_px=3000.0, orig_w=4000, orig_h=3000)
    )[0] == 73.7398


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
        image(lat=LAT0, lon=LON0 + 0.0001, alt=15.0, gimbal_yaw=270.0, gimbal_pitch=0.0, width=4000, height=3000),
        frame(offset=90.0),
    )
    assert close(p.position, (round(DE, 4), 10.0, 0.0)) and close(p.target, (0.0, 10.0, 0.0))
    x, z = true_to_plant(1.0, 0.0, 90.0)  # P1's helper: true north is plant -Z when plant north is true east
    assert abs(x) < 1e-12 and z == pytest.approx(-1.0)


def test_no_pose_without_gps_origin_or_direction():
    assert pose_from_exif(image(lat=None, lon=LON0, alt=25.0, gimbal_yaw=0.0), frame()) is None
    assert not has_gps(image(lat=LAT0, lon=None)) and has_gps(image(lat=LAT0, lon=LON0))
    assert pose_from_exif(image(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=0.0), frame(origin=False)) is None
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
        meta = {"latitude": cols["lat"], "longitude": cols["lon"], "altitude": cols["alt"], "width": 4000, "height": 3000}
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_poses.py -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.asset_review.poses'`

- [ ] **Step 3: Implement `poses.py`**

```python
# backend/app/asset_review/poses.py
"""Photo poses in the asset frame from EXIF and XMP (spec 2026-10-02-asset-findings §6.2).

`pose_from_exif` is the kit's `cameras.py` `pose()` reading Kestrel's `image` pose columns
(migration 0011) instead of the file; no file is opened. The differences are forced by what Kestrel
stores, and are listed in plan 2026-10-03-asset-findings-j2 ("What Kestrel stores"):
- altitude: `image.alt` (EXIF GPS); none -> the datum (y = 0), as the kit.
- yaw: gimbal yaw, then flight yaw (GPSImgDirection is not stored); none -> aim at the axis.
- field of view: `focal_mm` + `sensor_w_mm` (equal to the kit's 35 mm rule when import derived the
  sensor from it), then `focal_px` over the original long side, then 70 degrees; across the long side.
- plant north: positions and yaw are turned by `frame.north_offset_deg`, the true bearing of plant
  north. At 0 every number is the kit's (pinned by a parity test).
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.asset_review.frame import Frame, true_to_plant

R_EARTH_M = 6378137.0
DEFAULT_LONG_FOV_DEG = 70.0
MIN_ROLL_DEG = 0.5
MIN_HORIZONTAL = 1e-6
EXIF_ACCURACY_M = 3.0  # uncorrected GNSS, as app/pointclouds/cameras.py SIGMA_M

PoseSource = Literal["kit", "exif_gimbal", "exif_axis_aim", "manual"]
Vec3 = tuple[float, float, float]


class PoseIn(BaseModel):
    """One photo's pose in the asset frame (spec §5.3); what the job writes and J3/J5 read."""

    model_config = ConfigDict(frozen=True)
    position: Vec3
    target: Vec3
    up: Vec3
    hfov_deg: float = Field(gt=0, lt=180)
    vfov_deg: float = Field(gt=0, lt=180)
    source: PoseSource
    accuracy_m: float | None = None


def _num(value) -> float | None:
    """A finite float, else None (a junk column must never become a NaN pose)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pos(value) -> float | None:
    f = _num(value)
    return f if f is not None and f > 0 else None


def has_gps(image) -> bool:
    return _num(image.lat) is not None and _num(image.lon) is not None


def fov_deg(image) -> tuple[float, float]:
    """(hfov, vfov), rounded to 4 decimals. The lens angle spans the long side of the photo."""
    focal_mm, sensor_w = _pos(image.focal_mm), _pos(image.sensor_w_mm)
    focal_px, ow, oh = _pos(image.focal_px), _pos(image.orig_w), _pos(image.orig_h)
    if focal_mm and sensor_w:
        long_fov = 2 * math.degrees(math.atan(sensor_w / (2 * focal_mm)))
    elif focal_px and ow and oh:
        long_fov = 2 * math.degrees(math.atan(max(ow, oh) / (2 * focal_px)))
    else:
        long_fov = DEFAULT_LONG_FOV_DEG
    w, h = float(image.width), float(image.height)
    half = math.tan(math.radians(long_fov / 2))
    if w >= h:
        hf, vf = long_fov, 2 * math.degrees(math.atan(half * h / w))
    else:
        vf, hf = long_fov, 2 * math.degrees(math.atan(half * w / h))
    return round(hf, 4), round(vf, 4)


def pose_from_exif(image, frame: Frame) -> PoseIn | None:
    """The kit's `pose()` on `image`'s columns, in `frame`. None without an origin or GPS, or with
    no yaw while the camera stands on the asset axis (no direction to aim)."""
    origin = frame.origin
    lat, lon = _num(image.lat), _num(image.lon)
    if origin is None or lat is None or lon is None:
        return None
    lat0, lon0, alt0 = origin.lat, origin.lon, origin.ground_alt_m
    north = math.radians(lat - lat0) * R_EARTH_M
    east = math.radians(lon - lon0) * R_EARTH_M * math.cos(math.radians(lat0))
    x, z = true_to_plant(north, east, frame.north_offset_deg)
    alt = _num(image.alt)
    y = (alt if alt is not None else alt0) - alt0
    hf, vf = fov_deg(image)
    yaw = _num(image.gimbal_yaw)
    if yaw is None:
        yaw = _num(image.flight_yaw)
    pitch = _num(image.gimbal_pitch)
    if yaw is None:  # aim at the asset axis at the camera height, clamped to the asset
        ty = min(max(y, 0.0), frame.height_m or y)
        d = [-x, ty - y, -z]
        source = "exif_axis_aim"
    else:
        pr = math.radians(pitch if pitch is not None else 0.0)
        yr = math.radians(yaw - frame.north_offset_deg)
        d = [math.cos(pr) * math.cos(yr), math.sin(pr), math.cos(pr) * math.sin(yr)]
        source = "exif_gimbal"
    n = math.sqrt(sum(v * v for v in d))
    if n < 1e-9:
        return None
    d = [v / n for v in d]
    hz = d[0] ** 2 + d[2] ** 2
    t = -(x * d[0] + z * d[2]) / hz if hz > MIN_HORIZONTAL else (math.hypot(x, z) or 10.0)
    if t <= 0:  # the target is the point on the view ray nearest the vertical axis, never behind
        t = math.sqrt(x * x + z * z) or 10.0
    p = [x, y, z]
    target = [p[i] + d[i] * t for i in range(3)]
    up = [0.0, 1.0, 0.0]
    roll = _num(image.gimbal_roll)
    if roll and abs(roll) > MIN_ROLL_DEG:  # rotate world up about the view direction (Rodrigues)
        r = math.radians(roll)
        c, s = math.cos(r), math.sin(r)
        kv = sum(d[i] * up[i] for i in range(3))
        cr = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]
        up = [up[i] * c + cr[i] * s + d[i] * kv * (1 - c) for i in range(3)]
    return PoseIn(
        position=tuple(round(v, 4) for v in p),
        target=tuple(round(v, 4) for v in target),
        up=tuple(round(v, 5) for v in up),
        hfov_deg=hf,
        vfov_deg=vf,
        source=source,
        accuracy_m=EXIF_ACCURACY_M,
    )
```

- [ ] **Step 4: Run them to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_review_poses.py -q`
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_review/poses.py backend/tests/test_asset_review_poses.py
git commit -m "feat(asset-review): pose_from_exif, a port of kit cameras.py pose() on image columns (J2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: the `asset_pose` job (Review Focus 2)

**Files:**
- Create: `backend/app/asset_review/pose_job.py`
- Test: `backend/tests/test_asset_pose_job.py`

**Interfaces:**
- Consumes:
  - Task 1.
  - D1's `ImagePose` (columns `image_id`, `asset_model_id`, `position`, `target`, `up`, `hfov_deg`, `vfov_deg`, `source`, `accuracy_m`, `sequence`, `updated_at`; composite PK `(image_id, asset_model_id)`) and `AssetModel.frame`.
  - `app.db.models.Image`, `Source`, `Job` (existing).
- Produces:
  - `POSE_JOB = "asset_pose"`. The job takes params `{asset_model_id: str, image_ids: list[str] | None}`. It returns:

    ```
    {asset_model_id, total, estimated, posed, axis_aimed, kept, no_altitude, skipped,
     skipped_images: [{image_id, name, reason}]}
    ```

    C0's `JobType` description fixes `{asset_model_id, estimated, kept, skipped, skipped_images: [{image_id, reason}]}`; J2 adds the rest. `skipped` is the count and `skipped_images` lists at most 200 photos. A skip reason is `no_gps`, `on_axis` or `not_found`.
  - `run_asset_pose(ctx) -> dict`
  - `live_pose_job(handle, runner, asset_model_id: str) -> str | None`
  - `sequence_of(image, source_labels: dict[str, str | None]) -> str | None`
  - Constants: `PAGE = 500`, `MAX_REPORTED = 200`, `KEEP_SOURCES = ("kit", "manual")`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_pose_job.py
"""asset_pose (spec §6.2): writes exif poses, never overwrites kit or manual rows, and skips and
reports what it cannot pose (Review Focus 2)."""

import pytest
from fixtures.synthetic_tower import make_tower
from sqlalchemy import select

from app.asset_review.pose_job import KEEP_SOURCES, run_asset_pose, sequence_of
from app.db.models import AssetModel, Image, ImagePose, Source
from app.jobs.cancellation import JobCancelled, JobFailure

LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
FRAME = {
    "origin": {"lat": LAT0, "lon": LON0, "ground_alt_m": ALT0},
    "north_offset_deg": 0.0,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [],
    "levels": [],
    "presets": [],
}


class Ctx:
    def __init__(self, handle, params, cancel_after=None):
        self.project, self.params, self.job_id = handle, params, "job-pose"
        self.published, self.messages, self._checks, self._cancel_after = [], [], 0, cancel_after

    def progress(self, _f, message=""):
        self.messages.append(message)

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        self._checks += 1
        if self._cancel_after is not None and self._checks > self._cancel_after:
            raise JobCancelled()


def seed_model(handle, frame=FRAME):
    with handle.session() as s:
        m = AssetModel(name="Tower", status="ready", frame=frame)
        s.add(m)
        s.flush()
        return m.id


def seed_images(handle, rows, *, label="Flight 1"):
    with handle.session() as s:
        src = Source(folder="C:/photos", site="Site A", label=label)
        s.add(src)
        s.flush()
        ids = []
        for i, cols in enumerate(rows):
            im = Image(path=f"images/p{i:04d}.jpg", width=4000, height=3000, source_id=src.id, **cols)
            s.add(im)
            s.flush()
            ids.append(im.id)
        return ids


def poses(handle, mid):
    with handle.session() as s:
        return {
            p.image_id: (p.source, list(p.position), list(p.target), p.sequence)
            for p in s.scalars(select(ImagePose).where(ImagePose.asset_model_id == mid))
        }


def test_gimbal_photo_gets_an_exif_gimbal_pose(handle):
    mid = seed_model(handle)
    [a] = seed_images(
        handle,
        [dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0,
              original_name="DJI_0001.JPG")],
    )
    ctx = Ctx(handle, {"asset_model_id": mid, "image_ids": None})
    result = run_asset_pose(ctx)
    assert result["posed"] == 1 and result["axis_aimed"] == 0 and result["skipped"] == 0
    assert result["total"] == 1
    source, position, target, sequence = poses(handle, mid)[a]
    assert source == "exif_gimbal" and position == [11.1319, 20.0, 0.0]
    assert target[1] == pytest.approx(13.573, abs=1e-3)
    assert sequence == "Flight 1"  # no folder in original_name: the source label
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_pose_without_gps_is_skipped_and_reported(handle):
    mid = seed_model(handle)
    no_gps, ok = seed_images(
        handle,
        [
            dict(lat=None, lon=None, alt=25.0, gimbal_yaw=180.0, original_name="flight-2/DJI_0007.JPG"),
            dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, original_name="flight-2/DJI_0008.JPG"),
        ],
    )
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["posed"] == 1 and result["skipped"] == 1
    assert result["skipped_images"] == [{"image_id": no_gps, "name": "flight-2/DJI_0007.JPG", "reason": "no_gps"}]
    rows = poses(handle, mid)
    assert no_gps not in rows and rows[ok][0] == "exif_gimbal"
    assert rows[ok][3] == "flight-2"  # the photo's folder is its sequence


def test_pose_without_yaw_aims_at_axis(handle):
    mid = seed_model(handle)
    [a, b] = seed_images(
        handle,
        [
            dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0),  # no gimbal or flight yaw
            dict(lat=LAT0, lon=LON0, alt=25.0),  # no yaw, on the axis: nothing to aim at
        ],
    )
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["axis_aimed"] == 1 and result["posed"] == 0
    assert result["skipped_images"] == [{"image_id": b, "name": "images/p0001.jpg", "reason": "on_axis"}]
    source, position, target, _ = poses(handle, mid)[a]
    assert source == "exif_axis_aim" and position == [11.1319, 20.0, 0.0]
    assert target == pytest.approx([0.0, 20.0, 0.0], abs=1e-4)  # on the axis, at camera height


def test_kit_and_manual_rows_are_never_overwritten(handle):
    mid = seed_model(handle)
    cols = dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)
    kit_img, manual_img, old_img = seed_images(handle, [cols, cols, cols])
    kept = {"position": [1.0, 2.0, 3.0], "target": [0.0, 2.0, 0.0], "up": [0.0, 1.0, 0.0], "hfov_deg": 60.0,
            "vfov_deg": 45.0}
    with handle.session() as s:
        for image_id, source in ((kit_img, "kit"), (manual_img, "manual"), (old_img, "exif_axis_aim")):
            s.add(ImagePose(image_id=image_id, asset_model_id=mid, source=source, **kept))
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["kept"] == 2 and result["posed"] == 1
    rows = poses(handle, mid)
    assert rows[kit_img][:2] == ("kit", [1.0, 2.0, 3.0]) and rows[manual_img][:2] == ("manual", [1.0, 2.0, 3.0])
    assert rows[old_img][0] == "exif_gimbal" and rows[old_img][1] == [11.1319, 20.0, 0.0]
    assert KEEP_SOURCES == ("kit", "manual")


def test_scope_by_image_ids_reports_unknown_ids(handle):
    mid = seed_model(handle)
    a, b = seed_images(handle, [dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)] * 2)
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": [a, "missing", a]}))
    assert result["total"] == 2 and result["posed"] == 1
    assert result["skipped_images"] == [{"image_id": "missing", "name": None, "reason": "not_found"}]
    assert set(poses(handle, mid)) == {a}


def test_missing_altitude_is_counted(handle):
    mid = seed_model(handle)
    seed_images(handle, [dict(lat=LAT0 + 0.0001, lon=LON0, gimbal_yaw=180.0)])
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["posed"] == 1 and result["no_altitude"] == 1


def test_no_origin_fails_with_a_plain_message(handle):
    mid = seed_model(handle, frame={**FRAME, "origin": None})
    with pytest.raises(JobFailure, match="geographic origin"):
        run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    with pytest.raises(JobFailure, match="was deleted"):
        run_asset_pose(Ctx(handle, {"asset_model_id": "gone", "image_ids": None}))


def test_cancel_is_checked_per_photo(handle):
    mid = seed_model(handle)
    seed_images(handle, [dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)] * 3)
    ctx = Ctx(handle, {"asset_model_id": mid, "image_ids": None}, cancel_after=1)
    with pytest.raises(JobCancelled):
        run_asset_pose(ctx)
    assert ctx._checks == 2


def test_pages_cover_every_image(handle, monkeypatch):
    import app.asset_review.pose_job as pj

    monkeypatch.setattr(pj, "PAGE", 2)
    mid = seed_model(handle)
    ids = seed_images(handle, [dict(lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)] * 5)
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["posed"] == 5 and set(poses(handle, mid)) == set(ids)
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": ids}))
    assert result["posed"] == 5  # exif rows are refreshed, not kept


def test_sequence_of_prefers_the_photo_folder():
    im = Image(path="images/a.jpg", width=1, height=1, source_id="s", original_name="day1\\north\\DJI_1.JPG")
    assert sequence_of(im, {"s": "Flight 1"}) == "day1/north"
    im.original_name = "DJI_1.JPG"
    assert sequence_of(im, {"s": "Flight 1"}) == "Flight 1"
    assert sequence_of(im, {}) is None


def test_synthetic_tower_poses_round_trip(handle, tmp_path):
    """Image rows carrying the tower's own GPS and gimbal angles come back to its true poses."""
    tower = make_tower(tmp_path, photos=False)
    mid = seed_model(handle, frame=tower.frame.model_dump(mode="json"))
    rows = [
        dict(lat=p["latitude"], lon=p["longitude"], alt=p["altitude"], gimbal_yaw=p["yaw"],
             gimbal_pitch=p["pitch"], gimbal_roll=p["roll"], original_name=p["name"])
        for p in tower.poses
    ]
    ids = seed_images(handle, rows)
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["posed"] == len(tower.poses) == 32 and result["skipped"] == 0
    got = poses(handle, mid)
    for image_id, p in zip(ids, tower.poses, strict=True):
        _, position, target, _ = got[image_id]
        assert position == pytest.approx(p["position"], abs=2e-3)
        assert target == pytest.approx(p["target"], abs=2e-3)  # same nearest-to-axis rule as shoot.py
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_pose_job.py -q`
Expected: FAIL at collection with `ModuleNotFoundError: No module named 'app.asset_review.pose_job'`

- [ ] **Step 3: Implement `pose_job.py`**

```python
# backend/app/asset_review/pose_job.py
"""`asset_pose` (spec 2026-10-02-asset-findings §6.2): an `image_pose` row per photo in scope,
from the `image` pose columns. Column-only (no image file is opened), in keyset pages of PAGE
images. Rows with source `kit` or `manual` are never overwritten. A photo without GPS, or with no
yaw while standing on the asset axis, is skipped and named in the result; the job does not fail
for it (Review Focus 2)."""

from __future__ import annotations

from pathlib import PureWindowsPath

from sqlalchemy import func, select

from app.asset_review.frame import Frame
from app.asset_review.poses import has_gps, pose_from_exif
from app.db.base import utcnow
from app.db.models import AssetModel, Image, ImagePose, Job, Source
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

POSE_JOB = "asset_pose"
PAGE = 500
MAX_REPORTED = 200
KEEP_SOURCES = ("kit", "manual")


def live_pose_job(handle, runner, asset_model_id: str) -> str | None:
    """The id of a queued or running `asset_pose` job for this model that this process holds."""
    with handle.session() as s:
        rows = s.execute(
            select(Job.id, Job.params).where(Job.type == POSE_JOB, Job.state.in_(("queued", "running")))
        ).all()
    for job_id, params in rows:
        if (params or {}).get("asset_model_id") == asset_model_id and runner.is_live(job_id):
            return job_id
    return None


def sequence_of(image, source_labels: dict[str, str | None]) -> str | None:
    """The photo's folder inside its import (the kit's per-folder sequence), else its image set's label."""
    if image.original_name:
        parent = PureWindowsPath(image.original_name).parent.as_posix()
        if parent not in ("", "."):
            return parent
    return source_labels.get(image.source_id)


def _pages(handle, image_ids: list[str] | None):
    """Lists of at most PAGE image ids: the given ids in order without repeats, or every image by id."""
    if image_ids is not None:
        unique = list(dict.fromkeys(image_ids))
        for i in range(0, len(unique), PAGE):
            yield unique[i : i + PAGE]
        return
    last = ""
    while True:
        with handle.session() as s:
            page = list(s.scalars(select(Image.id).where(Image.id > last).order_by(Image.id).limit(PAGE)))
        if not page:
            return
        yield page
        last = page[-1]


@register_job_type(POSE_JOB)
def run_asset_pose(ctx) -> dict:
    mid = ctx.params["asset_model_id"]
    image_ids = ctx.params.get("image_ids")
    with ctx.project.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model was deleted.")
        frame = Frame.model_validate(model.frame) if model.frame else None
        labels = {src.id: (src.label or src.site or None) for src in s.scalars(select(Source))}
        total = (
            len(dict.fromkeys(image_ids))
            if image_ids is not None
            else s.scalar(select(func.count()).select_from(Image))
        )
    if frame is None or frame.origin is None:
        raise JobFailure("Set the asset's geographic origin (latitude, longitude, ground altitude) first.")
    counts = {"posed": 0, "axis_aimed": 0, "kept": 0, "no_altitude": 0}
    skipped: list[dict] = []
    skipped_count = 0
    done = 0
    ctx.progress(0, f"Estimating poses for {total:,} photos")
    for page in _pages(ctx.project, image_ids):
        with ctx.project.session() as s:
            found = {im.id: im for im in s.scalars(select(Image).where(Image.id.in_(page)))}
            existing = {
                p.image_id: p
                for p in s.scalars(
                    select(ImagePose).where(ImagePose.asset_model_id == mid, ImagePose.image_id.in_(page))
                )
            }
            for image_id in page:
                ctx.check_cancelled()
                done += 1
                image, old = found.get(image_id), existing.get(image_id)
                if image is not None and old is not None and old.source in KEEP_SOURCES:
                    counts["kept"] += 1
                    continue
                pose = pose_from_exif(image, frame) if image is not None else None
                if pose is None:
                    reason = "not_found" if image is None else ("no_gps" if not has_gps(image) else "on_axis")
                    skipped_count += 1
                    if len(skipped) < MAX_REPORTED:
                        name = (image.original_name or image.path) if image is not None else None
                        skipped.append({"image_id": image_id, "name": name, "reason": reason})
                    continue
                values = {
                    "position": list(pose.position),
                    "target": list(pose.target),
                    "up": list(pose.up),
                    "hfov_deg": pose.hfov_deg,
                    "vfov_deg": pose.vfov_deg,
                    "source": pose.source,
                    "accuracy_m": pose.accuracy_m,
                    "sequence": sequence_of(image, labels),
                    "updated_at": utcnow(),
                }
                if old is None:
                    s.add(ImagePose(image_id=image_id, asset_model_id=mid, **values))
                else:
                    for k, v in values.items():
                        setattr(old, k, v)
                counts["posed" if pose.source == "exif_gimbal" else "axis_aimed"] += 1
                if image.alt is None:
                    counts["no_altitude"] += 1
        ctx.progress(done / max(total, 1), f"Posed {counts['posed'] + counts['axis_aimed']:,} of {total:,} photos")
    ctx.publish("asset_models.changed", {"asset_model_ids": [mid]})
    return {
        "asset_model_id": mid,
        "total": total,
        "estimated": counts["posed"] + counts["axis_aimed"],
        **counts,
        "skipped": skipped_count,
        "skipped_images": skipped,
    }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_pose_job.py -q`
Expected: PASS (11 passed), including `test_pose_without_gps_is_skipped_and_reported` and `test_pose_without_yaw_aims_at_axis`.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/asset_review/pose_job.py backend/tests/test_asset_pose_job.py
git commit -m "feat(asset-review): asset_pose job; kit and manual poses kept, skips reported (J2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: the poses API (list, estimate, manual pose)

**Files:**
- Create: `backend/app/asset_review/pose_schemas.py`, `backend/app/asset_review/routes_poses.py`
- Modify: `backend/app/api.py` (one line in the guarded asset-models loop)
- Modify: `backend/app/asset_review/stubs.py` (delete the `listImagePoses`, `estimateImagePoses` and `putImagePose` tuples)
- Modify: `backend/tests/test_contract.py` (`REFUSES_VALID_DATA`)
- Test: `backend/tests/test_asset_poses_api.py`

**Interfaces:**
- Consumes:
  - Tasks 1 and 2.
  - `app.asset_models.store.get_model` (existing).
  - D1's `ImageReview.status`.
  - `app.events_util.publish_asset_models_changed` (existing).
- Produces, over HTTP, all under `/api/v1/projects/{projectId}`:

| Method | Path | operationId | Success | Refusals |
| --- | --- | --- | --- | --- |
| GET | `/asset-models/{assetModelId}/poses?sequence&image_id&after&limit` | `listImagePoses` | 200 `ImagePoseList {items, next}`; `limit` defaults to 500, at most 2,000; `image_id` at most 100 | 404; 422 for a limit outside 1 to 2,000 |
| POST | `/asset-models/{assetModelId}/poses/estimate` | `estimateImagePoses` | 202 `JobRef` | 404; 409 `job_running`; 422 `no_origin` |
| PUT | `/asset-models/{assetModelId}/poses/{imageId}` | `putImagePose` | 200 `ImagePose` | 404 for the model or the image; 422 `invalid_pose` |

- `ImagePose` (out) has the fields `image_id`, `position`, `target`, `up`, `hfov_deg`, `vfov_deg`, `source`, `accuracy_m`, `sequence`, `outcome` and `updated_at`. `outcome` is `image_review.status`, or null.
- `ImagePoseIn` has the fields:
  - `position`, `target`, `up`;
  - `hfov_deg` and `vfov_deg`, each above 0 and at most 180 as the contract says; 180 itself is refused as `invalid_pose`;
  - `accuracy_m` (optional, 0 or more);
  - `sequence` (optional, at most 120 characters).
- `PoseEstimateRequest` is `{image_ids?: string[]}`, with 1 to 100,000 ids (contract `ImagePoseEstimate`).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_poses_api.py
"""The poses API (spec §8): keyset list (max 2,000), estimate job, manual pose."""

import pytest

from app.db.models import AssetModel, Image, ImagePose, ImageReview, Source

BASE = "/api/v1/projects/{pid}/asset-models"
LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
FRAME = {
    "origin": {"lat": LAT0, "lon": LON0, "ground_alt_m": ALT0},
    "north_offset_deg": 0.0,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [],
    "levels": [],
    "presets": [],
}
MANUAL = {"position": [10.0, 5.0, 0.0], "target": [0.0, 5.0, 0.0], "up": [0.0, 1.0, 0.0], "hfov_deg": 60.0,
          "vfov_deg": 45.0, "accuracy_m": 0.5, "sequence": "hand placed"}


@pytest.fixture
def model_url(client, project_id, handle):
    r = client.post(BASE.format(pid=project_id), json={"name": "Tower"})
    mid = r.json()["id"]
    with handle.session() as s:
        s.get(AssetModel, mid).frame = FRAME
    return f"{BASE.format(pid=project_id)}/{mid}", mid


def seed_images(handle, n, **cols):
    with handle.session() as s:
        src = Source(folder="C:/photos", site="Site A", label="Flight 1")
        s.add(src)
        s.flush()
        rows = [Image(path=f"images/p{i:05d}.jpg", width=4000, height=3000, source_id=src.id, **cols) for i in range(n)]
        s.add_all(rows)
        s.flush()
        return [r.id for r in rows]


def test_estimate_then_list(client, model_url, handle, project_id, wait_job):
    url, mid = model_url
    a, b = seed_images(handle, 2, lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0)
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded" and job["type"] == "asset_pose"
    assert job["result"]["posed"] == 2 and job["result"]["skipped"] == 0
    with handle.session() as s:
        s.add(ImageReview(image_id=a, status="uncertain", note=""))
    body = client.get(f"{url}/poses").json()
    assert body["next"] is None and [i["image_id"] for i in body["items"]] == sorted([a, b])
    item = next(i for i in body["items"] if i["image_id"] == a)
    assert item["source"] == "exif_gimbal" and item["position"] == [11.1319, 20.0, 0.0]
    assert item["hfov_deg"] == 70.0 and item["sequence"] == "Flight 1" and item["accuracy_m"] == 3.0
    assert item["outcome"] == "uncertain"
    assert next(i for i in body["items"] if i["image_id"] == b)["outcome"] is None


def test_estimate_a_chosen_set(client, model_url, handle, project_id, wait_job):
    url, _ = model_url
    a, _b = seed_images(handle, 2, lat=LAT0 + 0.0001, lon=LON0, alt=25.0)
    r = client.post(f"{url}/poses/estimate", json={"image_ids": [a]})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["result"]["total"] == 1 and job["result"]["axis_aimed"] == 1
    assert [i["image_id"] for i in client.get(f"{url}/poses").json()["items"]] == [a]


def test_list_pages_by_image_id_at_most_2000(client, model_url, handle):
    url, mid = model_url
    ids = sorted(seed_images(handle, 2005))
    with handle.session() as s:
        s.add_all(
            ImagePose(image_id=i, asset_model_id=mid, source="exif_gimbal", sequence="s1" if n % 2 else "s2",
                      **{k: MANUAL[k] for k in ("position", "target", "up", "hfov_deg", "vfov_deg")})
            for n, i in enumerate(ids)
        )
    assert len(client.get(f"{url}/poses").json()["items"]) == 500  # the contract's default page
    first = client.get(f"{url}/poses", params={"limit": 2000}).json()
    assert len(first["items"]) == 2000 and first["next"] == ids[1999]
    second = client.get(f"{url}/poses", params={"after": first["next"], "limit": 2000}).json()
    assert [i["image_id"] for i in second["items"]] == ids[2000:] and second["next"] is None
    small = client.get(f"{url}/poses", params={"limit": 3, "sequence": "s1"}).json()
    assert [i["image_id"] for i in small["items"]] == ids[1:7:2] and small["next"] == ids[5]
    only = client.get(f"{url}/poses", params={"image_id": [ids[3], ids[10]]}).json()
    assert [i["image_id"] for i in only["items"]] == [ids[3], ids[10]]
    assert client.get(f"{url}/poses", params={"limit": 2001}).status_code == 422
    assert client.get(f"{url}/poses", params={"limit": 0}).status_code == 422


def test_estimate_without_origin_is_422(client, model_url, handle):
    url, mid = model_url
    with handle.session() as s:
        s.get(AssetModel, mid).frame = {**FRAME, "origin": None}
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_origin"
    with handle.session() as s:
        s.get(AssetModel, mid).frame = None
    assert client.post(f"{url}/poses/estimate").json()["error"]["code"] == "no_origin"


def test_estimate_while_one_is_live_is_409(client, model_url, monkeypatch):
    import app.asset_review.routes_poses as rp

    url, _ = model_url
    monkeypatch.setattr(rp, "live_pose_job", lambda *_a: "job-1")
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"]["job_id"] == "job-1"


def test_manual_pose_upserts_and_survives_an_estimate(client, model_url, handle, project_id, wait_job):
    url, _ = model_url
    [a] = seed_images(handle, 1, lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)
    r = client.put(f"{url}/poses/{a}", json=MANUAL)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["source"] == "manual" and out["position"] == [10.0, 5.0, 0.0] and out["sequence"] == "hand placed"
    again = client.put(f"{url}/poses/{a}", json={**MANUAL, "position": [12.0, 5.0, 0.0]}).json()
    assert again["position"] == [12.0, 5.0, 0.0]
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    assert job["result"]["kept"] == 1 and job["result"]["posed"] == 0
    assert client.get(f"{url}/poses").json()["items"][0]["position"] == [12.0, 5.0, 0.0]


def test_manual_pose_refusals(client, model_url, handle, project_id):
    url, _ = model_url
    [a] = seed_images(handle, 1)
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "target": MANUAL["position"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "up": [-1.0, 0.0, 0.0]})  # up along the view
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "hfov_deg": 180.0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "hfov_deg": 0.0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.put(f"{url}/poses/missing", json=MANUAL).status_code == 404
    other = f"{BASE.format(pid=project_id)}/missing/poses/{a}"
    assert client.put(other, json=MANUAL).status_code == 404
    assert client.get(f"{BASE.format(pid=project_id)}/missing/poses").status_code == 404


def test_synthetic_tower_photos_pose_from_their_exif(client, project_id, handle, tmp_path, import_source, wait_job):
    """The tower's 32 photos, imported for real (EXIF GPS and focal, DJI XMP gimbal yaw, pitch and
    roll), pose back to the tower's true cameras."""
    from fixtures.synthetic_tower import make_tower

    tower = make_tower(tmp_path, photos=True)
    mid = client.post(BASE.format(pid=project_id), json={"name": "Synthetic tower"}).json()["id"]
    with handle.session() as s:
        s.get(AssetModel, mid).frame = tower.frame.model_dump(mode="json")
    import_source(project_id, tower.photos_dir)
    url = f"{BASE.format(pid=project_id)}/{mid}"
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    assert job["state"] == "succeeded" and job["result"]["posed"] == 32, job
    with handle.session() as s:
        by_name = {im.original_name: im.id for im in s.query(Image)}
    items = {i["image_id"]: i for i in client.get(f"{url}/poses").json()["items"]}
    for p in tower.poses:
        item = items[by_name[p["name"]]]
        assert item["position"] == pytest.approx(p["position"], abs=0.02)
        assert item["target"] == pytest.approx(p["target"], abs=0.05)
        assert item["up"] == pytest.approx(p["up"], abs=1e-3)
        assert item["hfov_deg"] == pytest.approx(p["hfov"], abs=0.01)  # 35 mm rule via sensor_w_mm


def test_imported_photos_flow_from_exif_columns(client, model_url, project_id, tmp_path, make_jpeg, import_source,
                                                wait_job):
    """The real import path: GPS and lens columns reach the pose; a photo without GPS is reported."""
    url, _ = model_url
    folder = tmp_path / "photos"
    make_jpeg(folder / "with_gps.jpg", 400, 300, seed=1,
              exif={"lat": LAT0 + 0.0001, "lon": LON0, "alt": 25.0, "focal_mm": 8.8, "focal_35mm": 24})
    make_jpeg(folder / "no_gps.jpg", 400, 300, seed=2)
    import_source(project_id, folder)
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    result = job["result"]
    assert result["axis_aimed"] == 1 and result["skipped"] == 1  # no XMP yaw: aims at the axis
    assert result["skipped_images"][0]["reason"] == "no_gps"
    [item] = client.get(f"{url}/poses").json()["items"]
    assert item["position"] == pytest.approx([11.1319, 20.0, 0.0], abs=0.01)
    assert item["hfov_deg"] == pytest.approx(73.7398, abs=1e-3)  # sensor 36 * 8.8 / 24 = 13.2 mm
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_poses_api.py -q`
Expected: FAIL. The routes are still C0's 501 stubs, so `test_estimate_then_list` asserts 202 and gets 501. `test_estimate_while_one_is_live_is_409` errors with `ModuleNotFoundError: No module named 'app.asset_review.routes_poses'`.

- [ ] **Step 3: Implement `pose_schemas.py`**

```python
# backend/app/asset_review/pose_schemas.py
"""API shapes for photo poses (contract: ImagePose, ImagePoseList, ImagePoseIn, PoseEstimateRequest)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.jobs.schemas import JobOut

Finite = Annotated[float, Field(allow_inf_nan=False)]
Vec3 = tuple[Finite, Finite, Finite]
Outcome = Literal["finding", "none", "uncertain", "not_assessed"]
Source = Literal["kit", "exif_gimbal", "exif_axis_aim", "manual"]  # contract ImagePoseSource


class ImagePoseOut(BaseModel):
    image_id: str
    position: list[float]
    target: list[float]
    up: list[float]
    hfov_deg: float
    vfov_deg: float
    source: Source
    accuracy_m: float | None
    sequence: str | None
    outcome: Outcome | None
    updated_at: datetime

    @classmethod
    def of(cls, row, outcome: str | None) -> ImagePoseOut:
        return cls(
            image_id=row.image_id,
            position=list(row.position),
            target=list(row.target),
            up=list(row.up),
            hfov_deg=row.hfov_deg,
            vfov_deg=row.vfov_deg,
            source=row.source,
            accuracy_m=row.accuracy_m,
            sequence=row.sequence,
            outcome=outcome,
            updated_at=row.updated_at,
        )


class ImagePoseList(BaseModel):
    items: list[ImagePoseOut]
    next: str | None


class ImagePoseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: Vec3
    target: Vec3
    up: Vec3
    hfov_deg: float = Field(gt=0, le=180)  # the contract allows 180; `_check_pose` refuses it as a pose
    vfov_deg: float = Field(gt=0, le=180)
    accuracy_m: float | None = Field(None, ge=0)
    sequence: str | None = Field(None, max_length=120)


class PoseEstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_ids: list[str] | None = Field(None, min_length=1, max_length=100_000)


class PoseJobRef(BaseModel):
    job: JobOut
```

- [ ] **Step 4: Implement `routes_poses.py`**

```python
# backend/app/asset_review/routes_poses.py
"""Photo poses for an asset model (spec 2026-10-02-asset-findings §8): the paged list for the
cameras layer, the `asset_pose` job, and a manual pose."""

from __future__ import annotations

import math

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy import select

from app.asset_models import store
from app.asset_review.pose_job import POSE_JOB, live_pose_job
from app.asset_review.pose_schemas import (
    ImagePoseIn,
    ImagePoseList,
    ImagePoseOut,
    PoseEstimateRequest,
    PoseJobRef,
)
from app.db.base import utcnow
from app.db.models import Image, ImagePose, ImageReview
from app.errors import AppError, not_found
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
P = "/asset-models/{assetModelId}/poses"
MAX_PAGE = 2000
DEFAULT_PAGE = 500  # the contract's `assetPageLimit` default
MAX_IMAGE_FILTER = 100
MIN_LENGTH = 1e-6


@router.get(P, response_model=ImagePoseList)
def list_image_poses(
    assetModelId: str,  # noqa: N803
    after: str | None = Query(None, max_length=64),
    limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
    sequence: str | None = Query(None, max_length=120),
    image_id: list[str] | None = Query(None, max_length=MAX_IMAGE_FILTER),
    handle: ProjectHandle = Depends(get_project),
) -> ImagePoseList:
    with handle.session() as s:
        store.get_model(s, assetModelId)
        q = (
            select(ImagePose, ImageReview.status)
            .outerjoin(ImageReview, ImageReview.image_id == ImagePose.image_id)
            .where(ImagePose.asset_model_id == assetModelId)
        )
        if after:
            q = q.where(ImagePose.image_id > after)
        if sequence is not None:
            q = q.where(ImagePose.sequence == sequence)
        if image_id:
            q = q.where(ImagePose.image_id.in_(image_id))
        rows = s.execute(q.order_by(ImagePose.image_id).limit(limit + 1)).all()
        items = [ImagePoseOut.of(pose, status) for pose, status in rows[:limit]]
    more = len(rows) > limit
    return ImagePoseList(items=items, next=items[-1].image_id if more else None)


@router.post(P + "/estimate", response_model=PoseJobRef, status_code=202)
def estimate_image_poses(
    assetModelId: str,  # noqa: N803
    request: Request,
    body: PoseEstimateRequest | None = Body(None),
    handle: ProjectHandle = Depends(get_project),
) -> PoseJobRef:
    with handle.session() as s:
        frame = store.get_model(s, assetModelId).frame
    if not frame or not frame.get("origin"):
        raise AppError(
            "no_origin",
            "Set the asset's geographic origin (latitude, longitude and ground altitude) before estimating poses.",
            422,
        )
    runner = request.app.state.jobs
    live = live_pose_job(handle, runner, assetModelId)
    if live:
        raise AppError("job_running", "Poses are already being estimated for this model.", 409, {"job_id": live})
    image_ids = body.image_ids if body is not None else None
    job = runner.submit(handle, POSE_JOB, {"asset_model_id": assetModelId, "image_ids": image_ids})
    return PoseJobRef(job=JobOut.from_row(job, handle.id))


def _check_pose(body: ImagePoseIn) -> None:
    d = [body.target[i] - body.position[i] for i in range(3)]
    u = body.up
    cross = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
    nd, nu = math.sqrt(sum(v * v for v in d)), math.sqrt(sum(v * v for v in u))
    if nd < MIN_LENGTH:
        raise AppError("invalid_pose", "The target must differ from the camera position.", 422)
    if body.hfov_deg >= 180 or body.vfov_deg >= 180:
        raise AppError("invalid_pose", "A field of view must be narrower than 180 degrees.", 422)
    if nu < MIN_LENGTH or math.sqrt(sum(v * v for v in cross)) < MIN_LENGTH * nd * nu:
        raise AppError("invalid_pose", "The up vector must not point along the view direction.", 422)


@router.put(P + "/{imageId}", response_model=ImagePoseOut)
def put_image_pose(
    assetModelId: str,  # noqa: N803
    imageId: str,  # noqa: N803
    body: ImagePoseIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImagePoseOut:
    with handle.session() as s:
        store.get_model(s, assetModelId)
        if s.get(Image, imageId) is None:
            raise not_found("image", imageId)
        _check_pose(body)
        values = {
            "position": list(body.position),
            "target": list(body.target),
            "up": list(body.up),
            "hfov_deg": body.hfov_deg,
            "vfov_deg": body.vfov_deg,
            "source": "manual",
            "accuracy_m": body.accuracy_m,
            "sequence": body.sequence,
            "updated_at": utcnow(),
        }
        row = s.get(ImagePose, {"image_id": imageId, "asset_model_id": assetModelId})
        if row is None:
            row = ImagePose(image_id=imageId, asset_model_id=assetModelId, **values)
            s.add(row)
        else:
            for k, v in values.items():
                setattr(row, k, v)
        s.flush()
        status = s.scalar(select(ImageReview.status).where(ImageReview.image_id == imageId))
        out = ImagePoseOut.of(row, status)
    publish_asset_models_changed(request, handle, [assetModelId])
    return out
```

- [ ] **Step 5: Wire it up**

In `backend/app/api.py`, in the guarded loop that holds `"app.asset_models.runs"`, add one line directly above `"app.asset_review.stubs"` (C0's rule for owners; after J1's line if J1 merged first):

```python
    "app.asset_review.routes_poses",  # asset findings J2: photo poses (spec 2026-10-02-asset-findings §6.2)
```

In `backend/app/asset_review/stubs.py`, empty `J2_STUBS` (its tuples are `listImagePoses`, `estimateImagePoses` and `putImagePose`): `J2_STUBS: list[tuple[str, str, str]] = []`. If J2 is the last of D1 and J1 to J5 to land, also delete the module, its line in `app/api.py`, and its `EXPECTED_STUBS |=` line and import in `test_contract.py` (C0's rule).

In `backend/tests/test_contract.py` `REFUSES_VALID_DATA`, after `"deleteAssetModel": {409},`, or after J1's entries if they are there, add:

```python
    # asset findings J2: a model whose frame has no origin (`no_origin`) or with a pose job live
    # (`job_running`); a manual pose whose target is its position or whose up is along the view
    # (`invalid_pose`).
    "estimateImagePoses": {409, 422},
    "putImagePose": {422},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_poses_api.py tests/test_asset_pose_job.py tests/test_asset_review_poses.py -q`
Expected: PASS

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q -k "ImagePose or stub_list"`
Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git add backend/app/asset_review/pose_schemas.py backend/app/asset_review/routes_poses.py backend/app/api.py backend/app/asset_review/stubs.py backend/tests/test_contract.py backend/tests/test_asset_poses_api.py
git commit -m "feat(asset-review): poses API: keyset list, estimate job, manual pose (J2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gate, merge and walkthrough

**Files:** none new.

- [ ] **Step 1: Run the full gate in the worktree**

```powershell
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: every command exits 0. If `ruff format --check` reports files, run `ruff format` on them, re-run the tests, and commit by path. The `cargo test` step runs only when the frozen sidecar exists in the worktree; it normally does not.

- [ ] **Step 2: Merge.** Use `scripts\finish-task.ps1` or, on PowerShell 5.1, the manual merge. If J1 merged first, `backend/app/api.py` and `backend/tests/test_contract.py` conflict by one line each: keep both. Then remove the worktree, keeping the venv junction intact, and delete `task/af-j2`.

- [ ] **Step 3: Operator walkthrough.** J2 is backend only, observable through the API docs page:
  1. In a project with drone photos that carry GPS, create an asset model and set its frame origin. Use `PATCH` once J1 is merged, or ask for it to be set during acceptance.
  2. In `/docs`, call `estimateImagePoses` with `{}`. Expect 202 and a job "Posed N of M photos". Its result lists any photos without GPS by name.
  3. Call `listImagePoses`. Expect at most 2,000 poses and a `next` cursor when there are more.
  4. Call `putImagePose` for one photo. Re-run the estimate, and expect that photo's pose unchanged (`kept: 1`).

---

## Self-review

**Spec coverage (J2):**
- **§6.2 `exif_gimbal`:**
  - the flat-earth offset X = dlat·R, Z = dlon·R·cos(lat), Y = alt minus ground altitude;
  - the yaw and pitch direction, and the Rodrigues roll;
  - the target nearest the vertical axis;
  - the FOV rules.
- **§6.2 `exif_axis_aim`:** used when there is no yaw. No file is opened.
- **§6.2 kept rows:** `kit` and `manual` rows are never overwritten (tested).
- **§5.3:** every `image_pose` column is written.
- **§8:** list (keyset, at most 2,000, `sequence` filter, `outcome`), estimate (job) and manual PUT.
- **§12 poses:** hand-computed goldens for yaw, pitch, roll, axis aim and each FOV fallback, plus a parity test against a verbatim copy of the kit formula.
- **Review Focus 2:** `test_pose_without_gps_is_skipped_and_reported` and `test_pose_without_yaw_aims_at_axis` are in Task 2, as the index assigns. Neither case fails the job.
- **Index interface:** `app.asset_review.poses.pose_from_exif(image, frame) -> PoseIn | None` and `PoseIn(position, target, up, hfov_deg, vfov_deg, source, accuracy_m)` match the table.
- **Stubs:** `listImagePoses`, `estimateImagePoses` and `putImagePose` are removed.

## Index notes

1. **The 35 mm equivalent focal length is not stored.** This is a gap with no loss. Import converts `FocalLengthIn35mmFilm` into `sensor_w_mm` when the focal-plane tags are absent, so `focal_mm` plus `sensor_w_mm` reproduces the kit's first FOV rule. Other gaps are listed in "What Kestrel stores":
   - XMP `AbsoluteAltitude` is not stored; J2 uses the EXIF GPS altitude.
   - `GPSImgDirection` is not stored; a photo with only that tag aims at the axis.
   - J2 adds a `focal_px` fallback, and applies the FOV to the long side for portrait frames.

   None of these needs a migration. If DAMAC or EBSM acceptance shows altitude drift, a later unit adds an `abs_alt` column read from XMP.
2. **`north_offset_deg` sign.** P1 fixes it as the true bearing of plant north (plant bearing = true bearing minus the offset). J2 converts the GPS offset with P1's `app.asset_review.frame.true_to_plant` and turns yaw by `yaw - frame.north_offset_deg`; `test_plant_north_offset_turns_position_and_yaw` pins it.
3. **Checked against C0's plan (`2026-10-03-asset-findings-c0.md`).** These follow C0:
   - `ImagePose`, `ImagePoseIn`, `ImagePoseList` and `ImagePoseEstimate`;
   - the refusal codes `no_origin` and `job_running`;
   - the `listImagePoses` parameters `sequence`, `image_id`, `after`, and `limit` (default 500);
   - the `asset_pose` result keys `estimated`, `kept`, `skipped` and `skipped_images`.

   J2 adds `invalid_pose` for a manual pose with no direction, an up along the view, or a 180 degree field of view (the schema allows 180). It also adds the result counts `posed`, `axis_aimed`, `no_altitude` and `total`.
4. **The kit's divide by zero.** A photo with no yaw standing exactly on the axis makes the kit divide by zero. J2 skips that photo with reason `on_axis`.
5. **The job publishes `asset_models.changed`.** There is no `image_poses.changed` event type. If C0 added one, publish that instead.
