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
        [
            dict(
                lat=LAT0 + 0.0001,
                lon=LON0,
                alt=25.0,
                gimbal_yaw=180.0,
                gimbal_pitch=-30.0,
                original_name="DJI_0001.JPG",
            )
        ],
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
            dict(
                lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, original_name="flight-2/DJI_0008.JPG"
            ),
        ],
    )
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["posed"] == 1 and result["skipped"] == 1
    assert result["skipped_images"] == [
        {"image_id": no_gps, "name": "flight-2/DJI_0007.JPG", "reason": "no_gps"}
    ]
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
    kept = {
        "position": [1.0, 2.0, 3.0],
        "target": [0.0, 2.0, 0.0],
        "up": [0.0, 1.0, 0.0],
        "hfov_deg": 60.0,
        "vfov_deg": 45.0,
    }
    with handle.session() as s:
        for image_id, source in ((kit_img, "kit"), (manual_img, "manual"), (old_img, "exif_axis_aim")):
            s.add(ImagePose(image_id=image_id, asset_model_id=mid, source=source, **kept))
    result = run_asset_pose(Ctx(handle, {"asset_model_id": mid, "image_ids": None}))
    assert result["kept"] == 2 and result["posed"] == 1
    rows = poses(handle, mid)
    assert rows[kit_img][:2] == ("kit", [1.0, 2.0, 3.0]) and rows[manual_img][:2] == (
        "manual",
        [1.0, 2.0, 3.0],
    )
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
        dict(
            lat=p["latitude"],
            lon=p["longitude"],
            alt=p["altitude"],
            gimbal_yaw=p["yaw"],
            gimbal_pitch=p["pitch"],
            gimbal_roll=p["roll"],
            original_name=p["name"],
        )
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
