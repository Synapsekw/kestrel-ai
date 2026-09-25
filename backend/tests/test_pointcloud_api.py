"""Point-cloud CRUD, inspect, the import job, link rules and delete (spec §4, §6, §10)."""

import threading
import time

import pytest
from pointclouds import insert_cloud, make_las
from pyproj import CRS

from app.db.models import CloudMeasurement, GeoMap
from app.jobs.cancellation import JobFailure
from app.pointclouds import admission, service

BASE = "/api/v1/projects"
GB = 1_000_000_000


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture(autouse=True)
def plenty(monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 64 * GB)
    monkeypatch.setattr(admission, "free_disk", lambda folder: 2_000 * GB)
    monkeypatch.setattr(service, "converter_installed", lambda: True)


@pytest.fixture
def events(app, client):
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    return seen


def _map(handle, bounds_wgs84, epsg=32639, captured_on=None, status="ready"):
    crs = CRS.from_epsg(epsg)
    with handle.session() as s:
        m = GeoMap(
            name="Ortho",
            status=status,
            source_path="D:/o.tif",
            source_size=1,
            crs_wkt=crs.to_wkt(),
            epsg=epsg,
            proj4=crs.to_proj4(),
            bounds_wgs84=bounds_wgs84,
            captured_on=captured_on,
        )
        s.add(m)
        s.flush()
        return m.id


def _import(client, wait_job, project_id, path, **body):
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(path), **body})
    assert r.status_code == 202, r.text
    return r.json(), wait_job(project_id, r.json()["job"]["id"])


def test_import_to_ready(client, wait_job, project_id, handle, tmp_path, events):
    src = make_las(tmp_path / "Chimney stack 3D.las", 5_000, header_shrink_mm=0.3)
    created, job = _import(client, wait_job, project_id, src)
    assert created["cloud"]["status"] == "importing" and created["cloud"]["name"] == "Chimney stack 3D"
    assert job["state"] == "succeeded", job
    assert set(job["result"]) == {"cloud_id", "point_count", "epsg", "octree_bytes", "seconds"}
    c = client.get(f"{BASE}/{project_id}/pointclouds/{created['cloud']['id']}").json()
    assert (c["status"], c["point_count"], c["epsg"], c["bounds_repaired"], c["crs_source"]) == (
        "ready",
        5_000,
        32639,
        True,
        "file",
    )
    assert c["octree_spacing_m"] > 0 and c["z_stats"]["sample_count"] == 5_000 and c["class_counts"]
    assert c["captured_on"] is not None and c["source_sha256"] and c["job_id"] == created["job"]["id"]
    assert (handle.folder / "pointclouds" / c["id"] / "octree" / "metadata.json").is_file()
    assert any(e["type"] == "pointclouds.changed" for e in events)
    items = client.get(f"{BASE}/{project_id}/pointclouds").json()["items"]
    assert [i["id"] for i in items] == [c["id"]]


def test_newest_first(client, wait_job, project_id, tmp_path):
    a, _ = _import(client, wait_job, project_id, make_las(tmp_path / "a.las", 100))
    b, _ = _import(client, wait_job, project_id, make_las(tmp_path / "b.las", 100))
    assert [i["id"] for i in client.get(f"{BASE}/{project_id}/pointclouds").json()["items"]] == [
        b["cloud"]["id"],
        a["cloud"]["id"],
    ]


def test_missing_file_is_404_and_not_las_is_422(client, project_id, tmp_path):
    assert (
        client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(tmp_path / "nope.las")}).status_code
        == 404
    )
    junk = tmp_path / "junk.las"
    junk.write_bytes(b"not a point cloud")
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(junk)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_point_cloud"


def test_admission_refusal_creates_no_row(client, project_id, tmp_path, monkeypatch):
    monkeypatch.setattr(admission, "available_ram", lambda: 1 * GB)
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(make_las(tmp_path / "a.las", 100))})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_memory"
    assert "GB of free memory" in r.json()["error"]["message"]
    assert client.get(f"{BASE}/{project_id}/pointclouds").json()["items"] == []


def test_195m_points_refused_with_4_gb_free(client, project_id, tmp_path, monkeypatch):
    """Spec §17.3: admission reads the header's count, so a small file claiming 195 M points is enough."""
    src = make_las(tmp_path / "huge.las", 100)
    with open(src, "r+b") as f:  # LAS 1.2 legacy point count at byte 107
        f.seek(107)
        f.write((195_274_656).to_bytes(4, "little"))
    monkeypatch.setattr(admission, "available_ram", lambda: 4 * GB)
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(src)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_memory"
    assert r.json()["error"]["message"] == (
        "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again."
    )
    assert client.get(f"{BASE}/{project_id}/pointclouds").json()["items"] == []


def test_inspect_reports_facts_and_admission(client, project_id, tmp_path, monkeypatch):
    src = make_las(tmp_path / "a.laz", 1_000, compressed=True)
    r = client.post(f"{BASE}/{project_id}/pointclouds/inspect", json={"path": str(src)})
    assert r.status_code == 200, r.text
    info = r.json()
    assert (info["compressed"], info["point_count"], info["epsg"], info["has_rgb"]) == (
        True,
        1_000,
        32639,
        True,
    )
    assert info["admission"]["ok"] is True and info["admission"]["reason"] is None
    monkeypatch.setattr(service, "converter_installed", lambda: False)
    info = client.post(f"{BASE}/{project_id}/pointclouds/inspect", json={"path": str(src)}).json()
    assert info["admission"]["ok"] is False
    assert (
        info["admission"]["reason"]
        == "the point-cloud converter is not installed (run backend\\scripts\\fetch_potreeconverter.ps1)"
    )


def test_failed_import_is_failed_with_its_reason_and_no_folder(
    client, wait_job, project_id, handle, tmp_path, monkeypatch
):
    def broken(input_path, out_dir, *, progress, check_cancelled):
        raise JobFailure("the point-cloud converter stopped: ERROR(x)")

    monkeypatch.setattr("app.pointclouds.converter.run_converter", broken)
    created, job = _import(client, wait_job, project_id, make_las(tmp_path / "a.las", 100))
    assert job["state"] == "failed"
    c = client.get(f"{BASE}/{project_id}/pointclouds/{created['cloud']['id']}").json()
    assert (c["status"], c["error"]) == ("failed", "the point-cloud converter stopped: ERROR(x)")
    assert not (handle.folder / "pointclouds" / c["id"]).exists()


def _blocking_converter(started: threading.Event):
    def run(input_path, out_dir, *, progress, check_cancelled):
        started.set()
        while True:
            check_cancelled()
            time.sleep(0.05)

    return run


def test_cancel_and_delete_while_running(client, wait_job, project_id, handle, tmp_path, monkeypatch):
    started = threading.Event()
    monkeypatch.setattr("app.pointclouds.converter.run_converter", _blocking_converter(started))
    r = client.post(
        f"{BASE}/{project_id}/pointclouds", json={"path": str(make_las(tmp_path / "a.las", 100))}
    ).json()
    assert started.wait(20)
    cloud_id, job_id = r["cloud"]["id"], r["job"]["id"]
    busy = client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}")
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{job_id}/cancel")
    assert wait_job(project_id, job_id)["state"] == "cancelled"
    c = client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()
    assert (c["status"], c["error"]) == ("failed", "import cancelled")
    assert not (handle.folder / "pointclouds" / cloud_id).exists()


def test_delete_cascades_measurements_and_removes_the_folder(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    folder = handle.folder / "pointclouds" / cloud_id / "octree"
    folder.mkdir(parents=True)
    with handle.session() as s:
        s.add(
            CloudMeasurement(
                point_cloud_id=cloud_id, kind="point", name="Point 1", note=None, points=[], results={}
            )
        )
    assert client.delete(f"{BASE}/{project_id}/pointclouds/{cloud_id}").status_code == 204
    assert not folder.parent.exists()
    with handle.session() as s:
        assert s.query(CloudMeasurement).count() == 0
    assert client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").status_code == 404


BOX = [48.3744, 28.7038, 48.3755, 28.7048]


def test_link_rules(client, project_id, handle):
    cloud_id = insert_cloud(handle, bounds_wgs84=BOX)
    url = f"{BASE}/{project_id}/pointclouds/{cloud_id}"
    assert client.patch(url, json={"map_id": "nope"}).status_code == 404
    far = _map(handle, [10, 10, 11, 11])
    r = client.patch(url, json={"map_id": far})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_overlap"
    other_crs = _map(handle, [48.37, 28.70, 48.38, 28.71], epsg=32638)  # a different CRS that does overlap
    assert client.patch(url, json={"map_id": other_crs}).json()["map_id"] == other_crs
    assert client.patch(url, json={"map_id": None}).json()["map_id"] is None
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    r = client.patch(f"{BASE}/{project_id}/pointclouds/{bare}", json={"map_id": other_crs})
    assert r.status_code == 422 and r.json()["error"]["code"] == "link_needs_coordinates"


def test_deleting_the_map_nulls_the_link(client, project_id, handle):
    map_id = _map(handle, BOX)
    cloud_id = insert_cloud(handle, bounds_wgs84=BOX, map_id=map_id)
    assert client.delete(f"{BASE}/{project_id}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()["map_id"] is None


def test_assign_epsg_only_without_a_crs(client, project_id, handle):
    has = insert_cloud(handle)
    r = client.patch(f"{BASE}/{project_id}/pointclouds/{has}", json={"assign_epsg": 32638})
    assert r.status_code == 422 and r.json()["error"]["code"] == "crs_already_set"
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    url = f"{BASE}/{project_id}/pointclouds/{bare}"
    bad = client.patch(url, json={"assign_epsg": 999999})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_epsg"
    c = client.patch(url, json={"assign_epsg": 32639}).json()
    assert (c["epsg"], c["crs_source"]) == (32639, "assigned") and len(c["bounds_wgs84"]) == 4


def test_rename_and_captured_on(client, project_id, handle):
    cloud_id = insert_cloud(handle)
    url = f"{BASE}/{project_id}/pointclouds/{cloud_id}"
    c = client.patch(url, json={"name": "Stack", "captured_on": "2026-05-04"}).json()
    assert (c["name"], c["captured_on"]) == ("Stack", "2026-05-04")
    assert client.patch(url, json={"captured_on": None}).json()["captured_on"] is None


@pytest.mark.parametrize("status", ["importing", "failed"])
def test_linking_a_map_that_is_not_ready_is_409_not_ready(client, project_id, handle, tmp_path, status):
    """Cross-plan rule: a map whose import has not finished or failed answers 409 not_ready."""
    cloud_id = insert_cloud(handle, bounds_wgs84=BOX)
    pending = _map(handle, BOX, status=status)
    r = client.patch(f"{BASE}/{project_id}/pointclouds/{cloud_id}", json={"map_id": pending})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    assert client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()["map_id"] is None
    src = make_las(tmp_path / "a.las", 100)
    r = client.post(f"{BASE}/{project_id}/pointclouds", json={"path": str(src), "map_id": pending})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    assert client.get(f"{BASE}/{project_id}/pointclouds").json()["items"] == [
        client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}").json()
    ]


def test_create_links_a_ready_overlapping_map(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "a.las", 1_000)
    info = client.post(f"{BASE}/{project_id}/pointclouds/inspect", json={"path": str(src)}).json()
    assert info["epsg"] == 32639
    map_id = _map(handle, [-180, -90, 180, 90])
    created, job = _import(client, wait_job, project_id, src, map_id=map_id)
    assert created["cloud"]["map_id"] == map_id and job["state"] == "succeeded", job
