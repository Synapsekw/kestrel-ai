# backend/tests/test_asset_place_job.py
"""The asset_place job (plan 2026-10-03-asset-findings-j3 Task 5): rows, files, photo reads, dirty
runs, cancel, and the hand-off to asset_group. The synthetic tower, seeded straight into a project."""

import json
import logging
import time
from types import SimpleNamespace

import numpy as np
import pytest
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from PIL import Image as PILImage

from app.asset_models import store
from app.asset_review import jobs_place, place
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve
from app.db.models import AssetModel, FindingSighting, Job
from app.errors import AppError
from app.jobs.cancellation import JobCancelled, JobFailure


class FakeRunner:
    def __init__(self, fail: bool = False):
        self.catalogue, self.submitted, self.fail = None, [], fail

    def submit(self, handle, type, params):
        if self.fail:
            raise AppError("job_running", "already grouping", 409)
        self.submitted.append((type, params))
        return SimpleNamespace(id=f"job-{len(self.submitted)}")


class Ctx:
    def __init__(self, handle, params, *, runner=None, cancel_after=None):
        self.project, self.params, self.job_id = handle, params, "job-place"
        self.runner = runner or FakeRunner()
        self.log = logging.getLogger("test.asset_place")
        self.published, self.progress_calls = [], []
        self.cancel_after, self.checks = cancel_after, 0

    def progress(self, fraction, message=""):
        self.progress_calls.append((fraction, message))

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        self.checks += 1
        if self.cancel_after is not None and self.checks > self.cancel_after:
            raise JobCancelled()


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


@pytest.fixture(scope="module")
def truth(tower):
    mesh, _ = load_glb_mesh(tower.glb_path)
    return project_truth(tower, mesh)


def seed(handle, tower, items, type_id, profile="telecom_tower", polygons=()):
    """A model, one photo per pose used, and one sighting per item; items whose index is in
    `polygons` are drawn as diamonds."""
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve(profile, tower.frame.height_m))
    photos, sids = {}, []
    for k, ts in enumerate(items):
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(
                handle, mid, f"p{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index], seed=ts.pose_index
            )
        shape = diamond(ts.shape) if k in polygons else ts.shape
        sids.append(add_sighting(handle, mid, type_id, photos[ts.pose_index], shape))
    return mid, sids


def row(handle, sid):
    with handle.session() as s:
        r = s.get(FindingSighting, sid)
        s.expunge(r)
        return r


def test_the_job_places_pins_and_hands_over_to_grouping(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:6], crack["id"])
    ctx = Ctx(handle, {"asset_model_id": mid, "only_dirty": False})
    result = jobs_place.run_place(ctx)
    assert (result["point"], result["patch"], result["none"], result["no_pose"]) == (6, 0, 0, 0)
    assert (result["placed"], result["unplaced"]) == (6, 0)
    assert result["version"] == 1 and result["group_job_id"] == "job-1"
    centres = {t.id: np.asarray(t.center) for t in tower.truth}
    for ts, sid in zip(truth[:6], sids, strict=True):
        r = row(handle, sid)
        assert r.placement == "point" and r.placed_version == 1 and r.patch_path is None
        assert np.linalg.norm(np.array([r.cx, r.cy, r.cz]) - centres[ts.truth_id]) < 1.0
        assert np.linalg.norm([r.nx, r.ny, r.nz]) == pytest.approx(1.0, abs=1e-6)
        assert r.part and r.coverage > 0
    assert ctx.runner.submitted == [("asset_group", {"asset_model_id": mid})]
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_job_ray_miss_marks_none_and_succeeds(handle, tower, truth, crack):
    """Review Focus 2 at job level: a photo looking away from the tower gives `none`, never a fake
    hit, and the job still succeeds for the others."""
    mid, _ = seed(handle, tower, truth[:2], crack["id"])
    away = {
        "position": [60.0, 10.0, 0.0],
        "target": [90.0, 10.0, 0.0],
        "up": [0, 1, 0],
        "hfov": 60.0,
        "vfov": 45.0,
    }
    image = add_photo(handle, mid, "away.jpg", away)
    miss = add_sighting(handle, mid, crack["id"], image, place.SightingShape(700, 400, 200, 200))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["none"] == 1 and result["point"] == 2
    r = row(handle, miss)
    assert r.placement == "none" and r.placed_version == 1
    assert (r.cx, r.cy, r.cz, r.nx, r.part, r.patch_path) == (None,) * 6


def test_a_photo_without_a_pose_leaves_its_sighting_pending(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:1], crack["id"])
    bare = add_photo(handle, mid, "bare.jpg", None)
    sid = add_sighting(handle, mid, crack["id"], bare, place.SightingShape(700, 400, 200, 200))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["no_pose"] == 1 and result["point"] == 1
    assert (result["placed"], result["unplaced"]) == (1, 1)
    r = row(handle, sid)
    assert r.placement == "pending" and r.placed_version is None


def test_the_job_writes_patch_files_and_the_index(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:3], crack["id"], profile="building_facade", polygons={0})
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["patch"] == 1 and result["point"] == 2
    sid = sids[0]
    r = row(handle, sid)
    assert r.placement == "patch" and r.patch_path == f"asset_models/{mid}/placements/v1/{sid}.bin"
    folder = handle.folder / f"asset_models/{mid}/placements/v1"
    pos, uv = place.decode_patch((folder / f"{sid}.bin").read_bytes())
    assert len(pos) > 0 and len(pos) == len(uv) and len(pos) % 3 == 0
    with PILImage.open(folder / f"{sid}.png") as im:
        assert im.mode == "RGBA" and max(im.size) <= place.TEXTURE_MAX
    assert max(place.decode_labels((folder / f"{sid}.lbl").read_bytes()).shape) <= place.LABEL_MAX
    index = json.loads((folder / "index.json").read_text("utf-8"))
    assert index["version"] == 1 and set(index["items"]) == {sid} and len(index["items"][sid]["size"]) == 2


def test_each_photo_is_read_once_at_preview_size(handle, tower, truth, crack, monkeypatch):
    first = truth[0]
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    image = add_photo(handle, mid, "p.jpg", tower.poses[first.pose_index])
    for shape in (diamond(first.shape), diamond(first.shape), first.shape):
        add_sighting(handle, mid, crack["id"], image, shape)
    calls = []
    real = jobs_place.images.image_file
    monkeypatch.setattr(
        jobs_place.images,
        "image_file",
        lambda h, i, max_side: calls.append((i, max_side)) or real(h, i, max_side),
    )
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["patch"] == 2 and result["point"] == 1
    assert calls == [(image, 2048)]


def test_only_dirty_places_only_what_changed(handle, tower, truth, crack, monkeypatch):
    mid, sids = seed(handle, tower, truth[:4], crack["id"])
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    with handle.session() as s:
        s.get(FindingSighting, sids[2]).placement = "pending"  # J4 does this on a box edit
    calls = []
    real = place.place_sighting
    monkeypatch.setattr(place, "place_sighting", lambda *a, **k: calls.append(1) or real(*a, **k))
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid, "only_dirty": True}))
    assert len(calls) == 1 and result["point"] == 1
    assert row(handle, sids[2]).placement == "point"


def test_a_cancel_keeps_the_sightings_already_placed(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:5], crack["id"])
    with pytest.raises(JobCancelled):
        jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}, cancel_after=3))
    rows = [row(handle, sid) for sid in sids]
    assert sum(r.placed_version == 1 for r in rows) == 3
    assert sum(r.placement == "pending" for r in rows) == 2
    assert jobs_place.run_place(Ctx(handle, {"asset_model_id": mid, "only_dirty": True}))["point"] == 2


def test_the_job_fails_plainly_without_a_review_profile(handle, tower):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("telecom_tower", tower.frame.height_m))
    with handle.session() as s:
        s.get(AssetModel, mid).review = None
    with pytest.raises(JobFailure, match="review profile"):
        jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))


def test_a_full_run_prunes_stale_patch_files_and_old_versions(handle, tower, truth, crack):
    mid, sids = seed(handle, tower, truth[:2], crack["id"], profile="building_facade", polygons={0})
    root = handle.folder / f"asset_models/{mid}/placements"
    (root / "v0").mkdir(parents=True)
    (root / "v0" / "old.bin").write_bytes(b"x")
    (root / "v1").mkdir(parents=True, exist_ok=True)
    (root / "v1" / "ghost.png").write_bytes(b"x")
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert not (root / "v0").exists() and not (root / "v1" / "ghost.png").exists()
    assert (root / "v1" / f"{sids[0]}.bin").is_file()


def test_a_group_job_that_cannot_be_queued_does_not_fail_placement(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:1], crack["id"])
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}, runner=FakeRunner(fail=True)))
    assert result["point"] == 1 and result["group_job_id"] is None


def test_progress_is_throttled(handle, tower, truth, crack):
    mid, _ = seed(handle, tower, truth[:8], crack["id"])
    ctx = Ctx(handle, {"asset_model_id": mid})
    started = time.monotonic()
    jobs_place.run_place(ctx)
    elapsed = time.monotonic() - started
    assert len(ctx.progress_calls) <= 3 + int(elapsed / jobs_place.PROGRESS_EVERY_S)
    assert ctx.progress_calls[0][0] == 0 and ctx.progress_calls[-1][0] == 1


def _live_job(handle, type, mid, state="running"):
    with handle.session() as s:
        j = Job(type=type, state=state, params={"asset_model_id": mid})
        s.add(j)
        s.flush()
        return j.id


def test_submit_refuses_an_unknown_model_and_queues_a_known_one(handle, tower):
    runner = FakeRunner()
    with pytest.raises(AppError) as e:
        jobs_place.submit(handle, runner, "00000000-0000-0000-0000-000000000000", False)
    assert e.value.status == 404
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("telecom_tower", tower.frame.height_m))
    jobs_place.submit(handle, runner, mid, True)
    assert runner.submitted == [("asset_place", {"asset_model_id": mid, "only_dirty": True})]


def test_submit_answers_409_not_ready_without_a_ready_current_version(handle, tower):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("telecom_tower", tower.frame.height_m))
    with handle.session() as s:
        store.get_version(s, mid, 1).glb_status = "pending"
    with pytest.raises(AppError) as e:
        jobs_place.submit(handle, FakeRunner(), mid, False)
    assert (e.value.status, e.value.code) == (409, "not_ready")
    with handle.session() as s:
        s.get(AssetModel, mid).current_version = None
    with pytest.raises(AppError) as e:
        jobs_place.submit(handle, FakeRunner(), mid, False)
    assert (e.value.status, e.value.code) == (409, "not_ready")


@pytest.mark.parametrize("live_type", ["asset_place", "asset_group"])
def test_submit_answers_409_job_running_while_placing_or_grouping(handle, tower, live_type):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("telecom_tower", tower.frame.height_m))
    live = _live_job(handle, live_type, mid)
    runner = FakeRunner()
    with pytest.raises(AppError) as e:
        jobs_place.submit(handle, runner, mid, False)
    assert (e.value.status, e.value.code) == (409, "job_running")
    assert e.value.details == {"job_id": live} and runner.submitted == []


def test_one_sightings_failure_marks_it_none_and_the_job_succeeds(handle, tower, truth, crack, monkeypatch):
    mid, sids = seed(handle, tower, truth[:2], crack["id"])
    real, calls = place.place_sighting, []

    def flaky(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("boom")
        return real(*a, **k)

    monkeypatch.setattr(place, "place_sighting", flaky)
    result = jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    assert result["none"] == 1 and result["point"] == 1
    assert sorted(row(handle, sid).placement for sid in sids) == ["none", "point"]
