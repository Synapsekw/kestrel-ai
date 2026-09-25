"""Surfaces through the API: create -> surface_build -> ready, admission, sweep (spec §5, §3)."""

import re

import numpy as np
import pytest
from pyproj import CRS
from surfaces import WKT, cone_cloud, fixture_spec, plane, write_cloud
from volume_rows import add_cloud, add_surface

from app.db.models import Job, PointCloud, Surface, VolumeMeasurement
from app.jobs.cancellation import JobCancelled
from app.surfaces import build, service
from app.surfaces.grid import convention_problems
from app.surfaces.paths import build_dir, surface_path
from app.surfaces.startup import sweep_interrupted

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    return "detect"  # surfaces and volumes are detection work (F0: require_kind(("detect",), ANY_KIND))


@pytest.fixture
def cloud(handle, tmp_path):
    xyz = cone_cloud(25, 0.02, 0.0, size=30.0)
    path = write_cloud(tmp_path / "site.las", xyz)
    return add_cloud(handle, path, crs_wkt=WKT, name="Site")


def _build(client, wait_job, project_id, **body):
    r = client.post(f"{BASE}/{project_id}/surfaces", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    return r.json()["surface"], job


def test_build_resolves_defaults_and_ends_ready(client, wait_job, project_id, handle, cloud):
    created, job = _build(client, wait_job, project_id, point_cloud_id=cloud)
    assert created["status"] == "building" and created["name"] == "Site surface"
    assert created["build_params"]["despike_m"] == 1.0 and created["build_params"]["auto_cell"] is True
    assert created["build_params"]["cell_size_m"] is None
    assert job["state"] == "succeeded", job
    s = client.get(f"{BASE}/{project_id}/surfaces/{created['id']}").json()
    assert s["status"] == "ready" and s["kind"] == "cloud_dsm" and s["method"] == "median"
    assert s["cell_size_m"] == 0.5 and s["build_params"]["cell_size_m"] == 0.5
    assert s["stats"]["points_read"] == 22_500 and s["stats"]["auto_cell"] is True
    assert s["tile_grid"]["tile_size"] == 256 and s["epsg"] == 32639 and s["proj4"].startswith("+proj=utm")
    assert s["measurement_count"] == 0 and s["point_cloud_id"] == cloud
    assert convention_problems(surface_path(handle, s["id"])) == []
    assert not build_dir(handle, s["id"]).exists()
    assert job["result"] == {
        "surface_id": s["id"],
        "cell_size_m": 0.5,
        "coverage_fraction": s["coverage_fraction"],
    }


def test_explicit_null_despike_turns_it_off(client, wait_job, project_id, cloud):
    created, _ = _build(client, wait_job, project_id, point_cloud_id=cloud, despike_m=None, cell_size_m=0.4)
    assert created["build_params"]["despike_m"] is None and created["build_params"]["cell_size_m"] == 0.4


def test_admission_refusals(client, project_id, handle, tmp_path, cloud, monkeypatch):
    url = f"{BASE}/{project_id}/surfaces"
    r = client.post(url, json={"point_cloud_id": "nope"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    with monkeypatch.context() as m:
        m.setattr(service, "_disk_free", lambda path: 1000)
        r = client.post(url, json={"point_cloud_id": cloud})
        assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_disk"
    with monkeypatch.context() as m:
        m.setattr(service, "MAX_CELLS", 1000)
        m.setattr(build, "MAX_CELLS", 1000)  # the message's "smallest cell that fits" reads build's
        r = client.post(url, json={"point_cloud_id": cloud, "cell_size_m": 0.1})
        assert r.status_code == 422 and r.json()["error"]["code"] == "grid_too_large"
        message = r.json()["error"]["message"]
        fits = re.search(r"smallest cell size that fits is ([0-9.]+) m", message)
        assert fits and float(fits.group(1)) > 0.1, message
    r = client.post(url, json={"point_cloud_id": cloud, "z_clip": [5.0, 1.0]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_build_request"
    with handle.session() as s:
        s.get(PointCloud, cloud).source_size = 1
    r = client.post(url, json={"point_cloud_id": cloud})
    assert r.status_code == 422 and r.json()["error"]["code"] == "source_missing"
    assert "reconnect the drive" in r.json()["error"]["message"]
    with handle.session() as s:
        assert s.query(Surface).count() == 0  # no refusal leaves a row behind


def test_crs_rules(client, wait_job, project_id, handle, tmp_path):
    xyz = cone_cloud(4, 0.02, 0.0, size=10.0)
    feet = add_cloud(handle, write_cloud(tmp_path / "f.las", xyz), crs_wkt=CRS.from_epsg(2278).to_wkt())
    none = add_cloud(handle, write_cloud(tmp_path / "n.las", xyz), crs_wkt=None)
    url = f"{BASE}/{project_id}/surfaces"
    r = client.post(url, json={"point_cloud_id": feet})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_crs"
    assert "feet-based" in r.json()["error"]["message"]
    r = client.post(url, json={"point_cloud_id": none})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_crs"
    created, job = _build(client, wait_job, project_id, point_cloud_id=none, assume_metres=True)
    assert job["state"] == "succeeded", job
    got = client.get(f"{BASE}/{project_id}/surfaces/{created['id']}").json()
    assert got["status"] == "ready" and got["crs_wkt"] is None and got["proj4"] is None


def test_cloud_not_ready_is_409(client, project_id, handle, tmp_path):
    xyz = cone_cloud(4, 0.02, 0.0, size=10.0)
    importing = add_cloud(handle, write_cloud(tmp_path / "i.las", xyz), crs_wkt=WKT, status="importing")
    r = client.post(f"{BASE}/{project_id}/surfaces", json={"point_cloud_id": importing})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_require_ready_refuses_a_building_surface(handle):
    with handle.session() as s:
        row = Surface(name="b", kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    with pytest.raises(service.AppError) as e:
        service.require_ready(handle, sid)
    assert e.value.status == 409 and e.value.code == "not_ready"


def test_build_of_filtered_out_cloud_fails_cleanly(client, wait_job, project_id, handle, tmp_path):
    """Review focus 3."""
    xyz = cone_cloud(4, 0.02, 0.0, size=10.0)
    path = write_cloud(tmp_path / "noise.las", xyz, classification=np.full(len(xyz), 7))
    cloud = add_cloud(handle, path, crs_wkt=WKT)
    created, job = _build(client, wait_job, project_id, point_cloud_id=cloud)
    assert job["state"] == "failed" and "no points are left" in job["error"]
    s = client.get(f"{BASE}/{project_id}/surfaces/{created['id']}").json()
    assert s["status"] == "failed" and "no points are left" in s["error"]
    assert not build_dir(handle, s["id"]).exists()


def test_cancel_deletes_the_row_and_the_folder(client, wait_job, project_id, handle, cloud, monkeypatch):
    def stop(*a, **k):
        raise JobCancelled()  # may win the race with the create request's set_job: still a 202

    monkeypatch.setattr(build, "build_surface", stop)
    created, job = _build(client, wait_job, project_id, point_cloud_id=cloud)
    assert job["state"] == "cancelled"
    assert client.get(f"{BASE}/{project_id}/surfaces/{created['id']}").status_code == 404
    assert not (handle.surfaces_dir / created["id"]).exists()


@pytest.mark.parametrize(
    ("job_state", "error"),
    [("cancelled", service.CANCELLED_BEFORE_START), ("failed", service.STOPPED_BEFORE_FINISH)],
)
def test_building_row_whose_job_ended_reads_failed(client, project_id, handle, cloud, job_state, error):
    """A queued job cancelled before it started never runs `run_surface_build`; the read path
    settles the row instead of leaving it `building` until the next startup sweep."""
    with handle.session() as s:
        job = Job(type="surface_build", params={}, state=job_state)
        s.add(job)
        s.flush()
        row = Surface(name="q", kind="cloud_dsm", status="building", point_cloud_id=cloud, job_id=job.id)
        s.add(row)
        s.flush()
        sid = row.id
    items = client.get(f"{BASE}/{project_id}/surfaces").json()["items"]
    assert [(i["status"], i["error"]) for i in items] == [("failed", error)]
    got = client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()
    assert got["status"] == "failed" and got["error"] == error
    with handle.session() as s:
        assert s.get(Surface, sid).status == "failed"  # persisted, not only reported
    assert client.delete(f"{BASE}/{project_id}/surfaces/{sid}").status_code == 204


def test_set_job_reports_the_created_row_when_a_cancel_already_deleted_it(handle, cloud):
    with handle.session() as s:
        row = Surface(name="gone", kind="cloud_dsm", status="building", point_cloud_id=cloud)
        s.add(row)
        s.flush()
        s.expunge(row)
    with handle.session() as s:
        s.delete(s.get(Surface, row.id))
    out = service.set_job(handle, row.id, "job-1", created=row)
    assert out.id == row.id and out.job_id == "job-1"
    with pytest.raises(service.AppError) as e:
        service.set_job(handle, row.id, "job-1")
    assert e.value.status == 404


def test_rename_and_delete_rules(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, name="A")
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json={"name": "Pile survey"})
    assert r.status_code == 200 and r.json()["name"] == "Pile survey"
    other = add_surface(handle, fixture_spec(0.5), plane, name="B")
    with handle.session() as s:
        s.add(
            VolumeMeasurement(
                name="Pile 1",
                polygon_native=[[0, 0], [1, 0], [1, 1]],
                top_surface_id=other,
                base={"kind": "surface", "surface_id": sid, "z": None},
                masks={},
                alignment={},
                status="ready",
            )
        )
    for used in (sid, other):  # as a base and as a top
        r = client.delete(f"{BASE}/{project_id}/surfaces/{used}")
        assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
        assert "Pile 1" in r.json()["error"]["message"]
    assert client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()["measurement_count"] == 1
    free = add_surface(handle, fixture_spec(0.5), plane, name="C")
    assert client.delete(f"{BASE}/{project_id}/surfaces/{free}").status_code == 204
    assert not surface_path(handle, free).exists()
    assert client.get(f"{BASE}/{project_id}/surfaces/{free}").status_code == 404


def test_surface_survives_its_cloud(client, project_id, handle, tmp_path):
    """Review focus 4: the tif is self-contained; the read-through fields go null."""
    xyz = cone_cloud(4, 0.02, 0.0, size=10.0)
    cloud = add_cloud(handle, write_cloud(tmp_path / "c.las", xyz), crs_wkt=WKT)
    sid = add_surface(handle, fixture_spec(0.5), plane, cloud_id=cloud)
    with handle.session() as s:
        s.delete(s.get(PointCloud, cloud))
    got = client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()
    assert got["status"] == "ready" and got["point_cloud_id"] is None
    assert got["captured_on"] is None and got["map_id"] is None


def test_design_rows_are_listed_and_deleted_the_same_way(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, kind="design", method="tin")
    items = client.get(f"{BASE}/{project_id}/surfaces").json()["items"]
    assert [i["kind"] for i in items] == ["design"] and items[0]["build_params"] is None
    assert client.delete(f"{BASE}/{project_id}/surfaces/{sid}").status_code == 204


def test_sweep_fails_interrupted_builds_of_every_kind(handle, cloud):
    class Runner:
        def is_live(self, job_id):
            return job_id == "live"

    with handle.session() as s:
        dead = Surface(name="d", kind="cloud_dsm", status="building", job_id="gone")
        design = Surface(name="x", kind="design", status="building", job_id=None)
        live = Surface(name="l", kind="cloud_dsm", status="building", job_id="live")
        s.add_all([dead, design, live])
        s.flush()
        ids = dead.id, design.id, live.id
    for sid in ids:
        build_dir(handle, sid).mkdir(parents=True)
        (surface_path(handle, sid).parent / "surface.tif.partial").write_bytes(b"x")
    swept = sweep_interrupted(handle, Runner())
    assert sorted(swept) == sorted(ids[:2])
    with handle.session() as s:
        assert [s.get(Surface, i).status for i in ids] == ["failed", "failed", "building"]
        assert "restart" in s.get(Surface, ids[0]).error
    assert not build_dir(handle, ids[0]).exists() and build_dir(handle, ids[2]).exists()
    assert not (surface_path(handle, ids[0]).parent / "surface.tif.partial").exists()
    assert (surface_path(handle, ids[2]).parent / "surface.tif.partial").exists()
