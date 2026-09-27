"""C-B2 Task 2: the profile create seam and retry (spec 2026-09-26-point-cloud-workspace 8.2, 12 rows 8-9).

The job these submit is whatever `pointcloud_profile` is registered as; every assertion here reads
the returned objects or rows the job cannot have touched, except the retry test, which now waits for
the job to end before reading the row (Task 3's real job settles it, so reading early would race it)."""

import pytest
from pointclouds import insert_cloud
from profile_helpers import insert_profile
from pyproj import CRS

from app.db.models import CloudMeasurement
from app.errors import AppError
from app.pointclouds import profile, schemas

X, Y, Z = 243550.0, 3178050.0, 10.0


def _body(*, length=12.0, params=None, n=2, name=None):
    pts = [
        {"x": X, "y": Y, "z": Z, "uncertainty_m": 0.01},
        {"x": X + length, "y": Y, "z": Z + 3.0, "uncertainty_m": 0.02},
    ]
    raw = {"kind": "profile", "points": pts[:n]}
    if params is not None:
        raw["params"] = params
    if name:
        raw["name"] = name
    return schemas.CloudMeasurementCreate.model_validate(raw)


def _create(app, handle, cloud_id, body, **kw):
    return profile.create_profile_measurement(handle, app.state.jobs, cloud_id, body, **kw)


def _code(excinfo):
    return excinfo.value.code, excinfo.value.status


def test_profile_is_a_creatable_kind_with_params():
    assert "profile" in schemas.CreatableCloudMeasurementKind.__args__
    assert "params" in schemas.CloudMeasurementCreate.model_fields


def test_a_create_answers_the_computing_row_and_its_job(app, handle):
    cloud_id = insert_cloud(handle)
    out = _create(app, handle, cloud_id, _body())
    m = out.measurement
    assert (m.kind, m.status, m.error, m.name) == ("profile", "computing", None, "Cross-section 1")
    assert m.params.thickness_m == 0.2 and m.params.max_points == 200_000
    assert m.points[1].z == m.points[0].z == Z  # the line is horizontal (Ruling 3)
    assert out.job.type == "pointcloud_profile" and m.job_id == out.job.id
    assert out.job.params == {"cloud_id": cloud_id, "measurement_id": m.id}
    assert m.results.profile_length_m is None  # only the job computes numbers (section 3 C3)
    with handle.session() as s:
        assert s.get(CloudMeasurement, m.id).job_id == out.job.id


def test_params_and_name_are_kept_and_names_count_up(app, handle):
    cloud_id = insert_cloud(handle)
    first = _create(app, handle, cloud_id, _body(params={"thickness_m": 0.5, "max_points": 1000}))
    assert first.measurement.params.thickness_m == 0.5 and first.measurement.params.max_points == 1000
    assert _create(app, handle, cloud_id, _body()).measurement.name == "Cross-section 2"
    assert _create(app, handle, cloud_id, _body(name="Stack NE")).measurement.name == "Stack NE"


@pytest.mark.parametrize("length", [0.05, 2000.5])
def test_a_line_too_short_or_too_long_is_out_of_range(app, handle, length):
    cloud_id = insert_cloud(handle)
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body(length=length))
    assert _code(e) == ("profile_out_of_range", 422)


def test_a_line_outside_the_cloud_is_out_of_range(app, handle):
    cloud_id = insert_cloud(handle, bounds_native=[0.0, 0.0, 0.0, 10.0, 10.0, 10.0])
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body())
    assert _code(e) == ("profile_out_of_range", 422)


def test_one_point_is_the_wrong_count(app, handle):
    cloud_id = insert_cloud(handle)
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body(n=1))
    assert _code(e) == ("wrong_point_count", 422)


def test_a_cloud_in_degrees_needs_a_projected_crs(app, handle):
    cloud_id = insert_cloud(handle, crs_wkt=CRS.from_epsg(4326).to_wkt(), epsg=4326)
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body())
    assert _code(e) == ("needs_projected_crs", 422)


def test_a_cloud_that_is_not_ready_is_409(app, handle):
    cloud_id = insert_cloud(handle, status="importing")
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body())
    assert _code(e) == ("not_ready", 409)


def test_the_thousand_measurement_cap(app, handle, monkeypatch):
    monkeypatch.setattr(profile.measurements, "MAX_PER_CLOUD", 1)
    cloud_id = insert_cloud(handle)
    insert_profile(handle, cloud_id, status="ready")
    with pytest.raises(AppError) as e:
        _create(app, handle, cloud_id, _body())
    assert _code(e) == ("measurement_limit", 422)


def test_retry_starts_a_new_job_that_re_runs_and_settles_the_row(app, handle, project_id, wait_job):
    """The old `"boom"` error from the `failed` row `insert_profile` seeds must be gone once the
    retried job settles the row again (Task 3's job now really runs, so the race that let this test
    read the row before the job finished is no longer safe to assume)."""
    cloud_id = insert_cloud(handle)
    mid = insert_profile(handle, cloud_id, status="failed")
    job = profile.retry_profile(handle, app.state.jobs, cloud_id, mid)
    assert job.type == "pointcloud_profile" and job.params == {"cloud_id": cloud_id, "measurement_id": mid}
    ended = wait_job(project_id, job.id)
    assert ended["state"] == "failed", ended
    message = f"the source file is not reachable: {handle.folder / 'source.las'}"
    with handle.session() as s:
        row = s.get(CloudMeasurement, mid)
        assert (row.job_id, row.status, row.error) == (job.id, "failed", message)


@pytest.mark.parametrize("status", ["ready", "computing"])
def test_only_a_failed_profile_can_be_retried(app, handle, status):
    cloud_id = insert_cloud(handle)
    mid = insert_profile(handle, cloud_id, status=status)
    with pytest.raises(AppError) as e:
        profile.retry_profile(handle, app.state.jobs, cloud_id, mid)
    assert _code(e) == ("not_retryable", 409)


def test_another_kind_is_not_retryable_and_an_unknown_id_is_404(app, handle):
    cloud_id = insert_cloud(handle)
    mid = insert_profile(handle, cloud_id, status="failed", kind="distance")
    with pytest.raises(AppError) as e:
        profile.retry_profile(handle, app.state.jobs, cloud_id, mid)
    assert _code(e) == ("not_retryable", 409)
    with pytest.raises(AppError) as e:
        profile.retry_profile(handle, app.state.jobs, cloud_id, "nope")
    assert _code(e) == ("not_found", 404)


def test_the_profile_files_live_under_the_cloud(handle):
    base = handle.pointclouds_dir / "c1" / "profiles"
    assert profile.profiles_dir(handle, "c1") == base
    assert profile.profile_path(handle, "c1", "m1") == base / "m1.json"
    assert profile.partial_path(handle, "c1", "m1") == base / "m1.partial"
