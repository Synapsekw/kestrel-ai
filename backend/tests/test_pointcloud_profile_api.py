"""C-B2 Task 4: the profile routes (spec 2026-09-26-point-cloud-workspace section 12 rows 8-10)."""

import threading

import pytest
from pointclouds import ORIGIN, insert_cloud, make_las
from profile_helpers import cloud_from_las, insert_profile, line_points, wall_section

from app.findings import service
from app.findings.anchors import AnchorIn
from app.jobs.cancellation import JobFailure
from app.pointclouds import router, schemas

BASE = "/api/v1/projects"


def _meas(project_id, cloud_id, suffix=""):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/measurements{suffix}"


def _post_profile(client, project_id, cloud_id, **params):
    body = {"kind": "profile", "points": line_points(), **({"params": params} if params else {})}
    return client.post(_meas(project_id, cloud_id), json=body)


def test_the_two_profile_operations_are_no_longer_stubs():
    stubbed = {op for _, _, op in router.STUBS}
    assert not {"retryCloudProfile", "getCloudProfile"} & stubbed


def test_create_answers_202_then_the_profile_is_served(client, project_id, handle, wait_job, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section(step=0.02)))
    r = _post_profile(client, project_id, cloud_id)
    assert r.status_code == 202, r.text
    created = schemas.CloudMeasurementWithJob.model_validate(r.json())
    assert created.measurement.status == "computing" and created.job.type == "pointcloud_profile"
    assert wait_job(project_id, created.job.id)["state"] == "succeeded"
    listed = client.get(_meas(project_id, cloud_id)).json()["items"]
    assert [m["status"] for m in listed if m["id"] == created.measurement.id] == ["ready"]
    got = client.get(_meas(project_id, cloud_id, f"/{created.measurement.id}/profile"))
    assert got.status_code == 200
    assert got.headers["content-encoding"] == "gzip" and "accept-encoding" in got.headers["vary"].lower()
    body = schemas.CloudProfile.model_validate(got.json())
    assert set(got.json()) == {"s", "z", "rgb", "count", "thickness_m", "length_m"}
    assert body.count == len(wall_section(step=0.02)) and body.length_m == pytest.approx(10.0)


def test_no_gzip_without_accept_encoding_or_for_a_small_body(client, project_id, handle, wait_job, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section(step=0.02)))
    mid = _post_profile(client, project_id, cloud_id).json()["measurement"]["id"]
    wait_job(project_id, client.get(_meas(project_id, cloud_id)).json()["items"][0]["job_id"])
    plain = client.get(
        _meas(project_id, cloud_id, f"/{mid}/profile"), headers={"Accept-Encoding": "identity"}
    )
    assert plain.status_code == 200 and "content-encoding" not in plain.headers
    small_id = _post_profile(client, project_id, cloud_id, max_points=1000).json()["measurement"]["id"]
    items = {m["id"]: m for m in client.get(_meas(project_id, cloud_id)).json()["items"]}
    wait_job(project_id, items[small_id]["job_id"])
    small = client.get(_meas(project_id, cloud_id, f"/{small_id}/profile"))
    assert small.status_code == 200 and len(small.content) < 64 * 1024
    assert "content-encoding" not in small.headers


@pytest.mark.parametrize(("status", "fragment"), [("computing", "still being cut"), ("failed", "boom")])
def test_a_profile_that_is_not_ready_is_409(client, project_id, handle, status, fragment):
    cloud_id = insert_cloud(handle)
    mid = insert_profile(handle, cloud_id, status=status)
    r = client.get(_meas(project_id, cloud_id, f"/{mid}/profile"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    assert fragment in r.json()["error"]["message"]


def test_another_kind_or_a_missing_file_is_404(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    other = insert_profile(handle, cloud_id, status="ready", kind="distance")
    ready_without_file = insert_profile(handle, cloud_id, status="ready")
    for mid in (other, ready_without_file, "nope"):
        r = client.get(_meas(project_id, cloud_id, f"/{mid}/profile"))
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", mid


def test_retry_answers_202_and_the_profile_becomes_ready(client, project_id, handle, wait_job, tmp_path):
    cloud_id = cloud_from_las(handle, make_las(tmp_path / "wall.las", 0, points=wall_section()))
    mid = insert_profile(handle, cloud_id, status="failed")
    r = client.post(_meas(project_id, cloud_id, f"/{mid}/retry"))
    assert r.status_code == 202, r.text
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    assert client.get(_meas(project_id, cloud_id, f"/{mid}/profile")).status_code == 200


def test_retry_twice_starts_one_job(client, project_id, handle, wait_job, monkeypatch):
    gate = threading.Event()

    def held(cloud):  # keeps the first job running until both requests are answered
        gate.wait(10)
        raise JobFailure("stopped by the test")

    monkeypatch.setattr("app.pointclouds.export.check_source", held)
    cloud_id = insert_cloud(handle)
    mid = insert_profile(handle, cloud_id, status="failed")
    first = client.post(_meas(project_id, cloud_id, f"/{mid}/retry"))
    second = client.post(_meas(project_id, cloud_id, f"/{mid}/retry"))
    gate.set()
    assert first.status_code == 202
    assert second.status_code == 409 and second.json()["error"]["code"] == "not_retryable"
    assert wait_job(project_id, first.json()["job"]["id"])["error"] == "stopped by the test"


def test_retry_refusals(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    ready = insert_profile(handle, cloud_id, status="ready")
    r = client.post(_meas(project_id, cloud_id, f"/{ready}/retry"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_retryable"
    assert client.post(_meas(project_id, cloud_id, "/nope/retry")).status_code == 404


def test_create_refusals_carry_their_codes(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    body = {"kind": "profile", "points": line_points(length=0.05)}
    r = client.post(_meas(project_id, cloud_id), json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "profile_out_of_range"
    importing = insert_cloud(handle, status="importing")
    r = client.post(_meas(project_id, importing), json={"kind": "profile", "points": line_points()})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    bad = {"kind": "profile", "points": line_points(), "params": {"thickness_m": 9}}
    assert client.post(_meas(project_id, cloud_id), json=bad).status_code == 422


def test_delete_cloud_refused_while_its_profile_job_is_live_then_allowed(
    client, project_id, handle, wait_job, monkeypatch
):
    """A1: `service.delete_cloud` must refuse (409 `job_running`, same as import/export) while a
    `pointcloud_profile` job for one of the cloud's measurements is queued/running, and allow the
    delete once that job has settled."""
    gate = threading.Event()

    def held(cloud):  # keeps the profile job running until the test releases it
        gate.wait(10)
        raise JobFailure("stopped by the test")

    monkeypatch.setattr("app.pointclouds.export.check_source", held)
    x0, y0, z0 = ORIGIN
    cloud_id = insert_cloud(
        handle, bounds_native=[x0 - 20.0, y0 - 20.0, z0 - 20.0, x0 + 20.0, y0 + 20.0, z0 + 20.0]
    )
    created = _post_profile(client, project_id, cloud_id)
    assert created.status_code == 202, created.text
    job_id = created.json()["job"]["id"]

    busy = client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}")
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "job_running"

    gate.set()
    assert wait_job(project_id, job_id)["state"] == "failed"
    assert client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}").status_code == 204


def _pin(handle, crack, cloud_id) -> str:
    anchor = AnchorIn(kind="cloud", cloud_id=cloud_id, x=243550.0, y=3178050.0, z=10.0)
    return service.create_finding(handle, type_id=crack["id"], anchor=anchor).id


def test_create_with_a_valid_finding_id_stores_it_on_the_row(client, project_id, handle, crack):
    """Ruling 1: the route validates `finding_id` before the profile branch and passes it through
    to `create_profile_measurement`, which stores it without validating it again."""
    cloud_id = insert_cloud(handle, bounds_native=None)  # skip the box test (Ruling 4); line_points()
    fid = _pin(handle, crack, cloud_id)  # uses profile_helpers' ORIGIN, not this fixture's default bounds
    body = {"kind": "profile", "points": line_points(), "finding_id": fid}
    r = client.post(_meas(project_id, cloud_id), json=body)
    assert r.status_code == 202, r.text
    assert r.json()["measurement"]["finding_id"] == fid
    listed = client.get(_meas(project_id, cloud_id)).json()["items"]
    assert [m["finding_id"] for m in listed if m["kind"] == "profile"] == [fid]


def test_an_unknown_finding_id_is_refused_like_other_kinds(client, project_id, handle):
    """The same `invalid_finding` refusal other kinds get (test_cloud_measurement_findings.py); the
    profile branch is never reached because `require_finding` runs first."""
    cloud_id = insert_cloud(handle)
    body = {"kind": "profile", "points": line_points(), "finding_id": "f-does-not-exist"}
    r = client.post(_meas(project_id, cloud_id), json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_finding"
    assert client.get(_meas(project_id, cloud_id)).json()["items"] == []


def test_the_other_kinds_still_answer_201(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    pts = [
        {"x": 243550.0, "y": 3178050.0, "z": 10.0, "uncertainty_m": 0.01},
        {"x": 243553.0, "y": 3178054.0, "z": 10.0, "uncertainty_m": 0.01},
    ]
    r = client.post(_meas(project_id, cloud_id), json={"kind": "distance", "points": pts})
    assert r.status_code == 201 and r.json()["status"] == "ready"
