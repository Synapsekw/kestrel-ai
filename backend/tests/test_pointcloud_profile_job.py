"""C-B2 Task 3: the pointcloud_profile job (spec 2026-09-26-point-cloud-workspace 8.4, 14, 15)."""

import json
import os
import time

import pytest
from pointclouds import make_las
from profile_helpers import Z0, cloud_from_las, insert_profile, line_points, wall_section

from app.db.models import CloudMeasurement
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import cancelled_before_start_hook
from app.pointclouds import profile, profile_cut, schemas
from app.pointclouds.jobs_profile import run_pointcloud_profile


class _Ctx:
    def __init__(self, handle, params, *, job_id="job-test", on_check=None):
        self.project, self.params, self.job_id = handle, params, job_id
        self.published: list[tuple[str, dict]] = []
        self.calls, self.on_check = 0, on_check

    def progress(self, *_a):
        pass

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        self.calls += 1
        if self.on_check:
            self.on_check(self.calls)


def _row(handle, mid):
    with handle.session() as s:
        row = s.get(CloudMeasurement, mid)
        if row is not None:
            s.expunge(row)
        return row


def _submit(app, handle, cloud_id, **params):
    body = schemas.CloudMeasurementCreate.model_validate(
        {"kind": "profile", "points": line_points(), **({"params": params} if params else {})}
    )
    return profile.create_profile_measurement(handle, app.state.jobs, cloud_id, body)


def test_a_wall_section_is_cut_stored_and_reported(app, handle, project_id, wait_job, tmp_path):
    seen = []
    real = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), real(e))
    try:
        cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
        out = _submit(app, handle, cloud_id)
        job = wait_job(project_id, out.job.id)
    finally:
        app.state.events.publish = real
    mid = out.measurement.id
    assert job["state"] == "succeeded", job
    assert job["result"] == {"measurement_id": mid, "count": len(wall_section())}
    row = _row(handle, mid)
    assert (row.status, row.error) == ("ready", None)
    r = row.results
    assert r["profile_point_count"] == len(wall_section())
    assert r["profile_length_m"] == pytest.approx(10.0)
    assert r["profile_width_max_m"] == pytest.approx(0.4, abs=0.001)
    assert r["profile_z_min"] == pytest.approx(Z0) and r["profile_z_max"] == pytest.approx(Z0 + 10.0)
    path = profile.profile_path(handle, cloud_id, mid)
    data = json.loads(path.read_text("utf-8"))
    assert data["header"]["version"] == 1 and data["header"]["source_sha256"] == "ab" * 32
    assert data["header"]["thickness_m"] == 0.2 and data["header"]["max_points"] == 200_000
    body = schemas.CloudProfile.model_validate(data["profile"])
    assert body.count == len(body.s) == len(body.z) == len(body.rgb) // 3 == len(wall_section())
    assert all(round(v, 3) == v for v in body.s[:50])  # millimetres
    assert not list(path.parent.glob("*.partial"))
    assert any(e["type"] == "pointclouds.changed" and e["payload"] == {"cloud_ids": [cloud_id]} for e in seen)


def test_an_empty_slab_completes_with_zero_points(app, handle, project_id, wait_job, tmp_path):
    src = make_las(tmp_path / "wall.las", 0, points=wall_section())
    cloud_id = cloud_from_las(handle, src, bounds_native=[0.0, 0.0, -100.0, 1e7, 1e7, 100.0])
    body = schemas.CloudMeasurementCreate.model_validate({"kind": "profile", "points": line_points(dy=3.0)})
    out = profile.create_profile_measurement(handle, app.state.jobs, cloud_id, body)
    assert wait_job(project_id, out.job.id)["state"] == "succeeded"
    row = _row(handle, out.measurement.id)
    assert row.status == "ready" and row.results["profile_point_count"] == 0
    assert row.results["profile_width_max_m"] is None


def test_an_unreachable_source_fails_the_measurement(app, handle, project_id, wait_job, tmp_path):
    src = make_las(tmp_path / "gone.las", 0, points=wall_section())
    cloud_id = cloud_from_las(handle, src)
    src.unlink()
    out = _submit(app, handle, cloud_id)
    job = wait_job(project_id, out.job.id)
    message = f"the source file is not reachable: {src}"
    assert (job["state"], job["error"]) == ("failed", message)
    row = _row(handle, out.measurement.id)
    assert (row.status, row.error) == ("failed", message)
    assert not profile.profiles_dir(handle, cloud_id).exists() or not any(
        profile.profiles_dir(handle, cloud_id).iterdir()
    )


def test_a_changed_source_fails_the_measurement(app, handle, project_id, wait_job, tmp_path):
    src = make_las(tmp_path / "edited.las", 0, points=wall_section())
    cloud_id = cloud_from_las(handle, src)
    later = time.time() + 60
    os.utime(src, (later, later))
    out = _submit(app, handle, cloud_id)
    wait_job(project_id, out.job.id)
    row = _row(handle, out.measurement.id)
    assert (row.status, row.error) == ("failed", "the source file changed since import; import it again")


def test_cancel_removes_the_partial_file(handle, tmp_path, monkeypatch):
    monkeypatch.setattr(profile_cut, "CHUNK", 500)
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id)

    def cancel_on_third(n):
        if n == 3:
            raise JobCancelled()

    ctx = _Ctx(handle, {"cloud_id": cloud_id, "measurement_id": mid}, on_check=cancel_on_third)
    with pytest.raises(JobCancelled):
        run_pointcloud_profile(ctx)
    folder = profile.profiles_dir(handle, cloud_id)
    assert not folder.exists() or not any(folder.iterdir())
    row = _row(handle, mid)
    assert (row.status, row.error) == ("failed", profile.CANCELLED)
    assert ("pointclouds.changed", {"cloud_ids": [cloud_id]}) in ctx.published


def test_a_cancel_before_start_settles_the_row(handle, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id, job_id="job-test")
    ctx = _Ctx(handle, {"cloud_id": cloud_id, "measurement_id": mid})
    cancelled_before_start_hook("pointcloud_profile")(ctx)
    assert (_row(handle, mid).status, _row(handle, mid).error) == ("failed", profile.CANCELLED)
    assert ctx.published == [("pointclouds.changed", {"cloud_ids": [cloud_id]})]


def test_a_measurement_deleted_mid_job_leaves_no_file(handle, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id)

    def delete_row(n):
        if n == 1:
            with handle.session() as s:
                s.delete(s.get(CloudMeasurement, mid))

    ctx = _Ctx(handle, {"cloud_id": cloud_id, "measurement_id": mid}, on_check=delete_row)
    with pytest.raises(JobFailure, match=profile.DELETED):
        run_pointcloud_profile(ctx)
    folder = profile.profiles_dir(handle, cloud_id)
    assert not folder.exists() or not any(folder.iterdir())


def test_a_job_settles_a_row_whose_job_id_is_not_written_yet(handle, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id, job_id=None)
    run_pointcloud_profile(_Ctx(handle, {"cloud_id": cloud_id, "measurement_id": mid}))
    assert _row(handle, mid).status == "ready"


def test_a_stale_job_never_overwrites_a_newer_run(handle, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id, job_id="the-newer-job")
    with pytest.raises(JobFailure, match=profile.DELETED):
        run_pointcloud_profile(_Ctx(handle, {"cloud_id": cloud_id, "measurement_id": mid}, job_id="old"))
    assert (_row(handle, mid).status, _row(handle, mid).error) == ("computing", None)


def test_max_points_is_honoured(app, handle, project_id, wait_job, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "dense.las", 0, points=wall_section(step=0.02)))
    out = _submit(app, handle, cloud_id, max_points=1000)
    assert wait_job(project_id, out.job.id)["result"]["count"] <= 1000
    data = json.loads(profile.profile_path(handle, cloud_id, out.measurement.id).read_text("utf-8"))
    assert data["profile"]["count"] <= 1000 and data["header"]["cell_m"] is not None
