"""LAZ export (spec §11): streamed from the source, bounds repaired, CRS, sidecars, refusals, cancel."""

import csv
import json
import os
import time

import laspy
import numpy as np
import pytest
from pointclouds import insert_cloud, make_las
from pyproj import CRS

from app.db.models import CloudMeasurement
from app.jobs.cancellation import JobCancelled
from app.pointclouds import export
from app.pointclouds.jobs_export import run_pointcloud_export

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    return "detect"


def _cloud_from(handle, src, **overrides):
    with laspy.open(src) as r:
        las = r.read()
        scale = list(map(float, r.header.scales))
    xyz = np.column_stack([las.x, las.y, las.z])
    st = src.stat()
    return insert_cloud(
        handle,
        name="Chimney stack 3D",
        source_path=str(src),
        source_size=st.st_size,
        source_mtime=st.st_mtime,
        point_count=len(xyz),
        scale=scale,
        bounds_native=[*map(float, xyz.min(0)), *map(float, xyz.max(0))],
        **overrides,
    )


def _export(client, wait_job, project_id, cloud_id, **body):
    r = client.post(f"{BASE}/{project_id}/pointclouds/{cloud_id}/exports", json={"format": "laz", **body})
    assert r.status_code == 202, r.text
    return wait_job(project_id, r.json()["job"]["id"])


def test_exports_a_repaired_laz_with_sidecars(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "chimney.las", 20_000, header_shrink_mm=0.3)
    cloud_id = _cloud_from(handle, src)
    with handle.session() as s:
        s.add(
            CloudMeasurement(
                point_cloud_id=cloud_id,
                kind="distance",
                name="Distance 1",
                note="gate",
                points=[
                    {"x": 1, "y": 2, "z": 3, "uncertainty_m": 0.01},
                    {"x": 4, "y": 6, "z": 3, "uncertainty_m": 0.02},
                ],
                results={"distance_3d": 5.0, "uncertainty_m": 0.0224},
            )
        )
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["state"] == "succeeded", job
    res = job["result"]
    folder = handle.folder / res["folder"]
    laz = folder / res["laz"]
    assert res["laz"] == "cloud-chimney-stack-3d.laz" and res["point_count"] == 20_000
    with laspy.open(laz) as r:
        assert r.header.point_count == 20_000 and r.header.parse_crs().to_epsg() == 32639
        las = r.read()
        mins, maxs = r.header.mins, r.header.maxs
    xyz = np.column_stack([las.x, las.y, las.z])
    assert np.all(mins <= xyz.min(0)) and np.all(maxs >= xyz.max(0))
    assert laz.stat().st_size < src.stat().st_size
    meta = json.loads((folder / "cloud-chimney-stack-3d.json").read_text("utf-8"))
    assert meta["point_count"] == 20_000 and meta["epsg"] == 32639 and meta["source"]["path"] == str(src)
    with (folder / "cloud-chimney-stack-3d-measurements.csv").open(newline="", encoding="utf-8") as f:
        rows_ = list(csv.DictReader(f))
    assert list(rows_[0])[:12] == [
        "id",
        "name",
        "kind",
        "note",
        "x1",
        "y1",
        "z1",
        "u1",
        "x2",
        "y2",
        "z2",
        "u2",
    ]
    assert rows_[0]["distance_3d"] == "5.0" and rows_[0]["note"] == "gate"
    assert not list((handle.folder / "exports").glob(".partial-*"))


def test_no_measurements_file_when_not_asked(client, wait_job, project_id, handle, tmp_path):
    cloud_id = _cloud_from(handle, make_las(tmp_path / "a.las", 1_000))
    job = _export(client, wait_job, project_id, cloud_id, include_measurements=False)
    assert all(not f.endswith("measurements.csv") for f in job["result"]["files"])


def test_assigned_crs_is_written(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "bare.las", 1_000, epsg=None)
    cloud_id = _cloud_from(handle, src, crs_source="assigned", epsg=32639)
    job = _export(client, wait_job, project_id, cloud_id)
    with laspy.open(handle.folder / job["result"]["folder"] / job["result"]["laz"]) as r:
        assert r.header.parse_crs().to_epsg() == 32639


def test_a_missing_source_is_refused(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "gone.las", 1_000)
    cloud_id = _cloud_from(handle, src)
    src.unlink()
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["state"] == "failed" and job["error"] == f"the source file is not reachable: {src}"


def test_a_changed_source_is_refused(client, wait_job, project_id, handle, tmp_path):
    src = make_las(tmp_path / "edited.las", 1_000)
    cloud_id = _cloud_from(handle, src)
    later = time.time() + 60
    os.utime(src, (later, later))
    job = _export(client, wait_job, project_id, cloud_id)
    assert job["error"] == "the source file changed since import; import it again"


def test_not_ready_is_409(client, project_id, handle):
    cloud_id = insert_cloud(handle, status="importing")
    r = client.post(f"{BASE}/{project_id}/pointclouds/{cloud_id}/exports", json={"format": "laz"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


class _Ctx:
    def __init__(self, handle, params, cancel_after):
        self.project, self.params, self.job_id = handle, params, "job-test"
        self.calls, self.cancel_after = 0, cancel_after

    def progress(self, *_a):
        pass

    def publish(self, *_a):
        pass

    def check_cancelled(self):
        self.calls += 1
        if self.calls > self.cancel_after:
            raise JobCancelled()


def test_cancel_removes_the_partial_folder(handle, tmp_path, monkeypatch):
    monkeypatch.setattr(export, "CHUNK", 1_000)
    cloud_id = _cloud_from(handle, make_las(tmp_path / "big.las", 10_000))
    ctx = _Ctx(handle, {"cloud_id": cloud_id, "format": "laz", "include_measurements": True}, cancel_after=3)
    with pytest.raises(JobCancelled):
        run_pointcloud_export(ctx)
    exports = handle.folder / "exports"
    assert not list(exports.glob(".partial-*")) and not [p for p in exports.iterdir() if p.is_dir()]


def test_slug():
    assert export.slug("Chimney stack 3D") == "chimney-stack-3d"
    assert export.slug("   ") == "cloud"


def test_horizontal_epsg_of_a_compound_crs():
    """R12: `to_epsg()` on a compound CRS is None, so `verify_laz` must compare the horizontal
    sub-CRS's EPSG on both sides. `make_las` cannot write a compound CRS (it only ever calls
    `header.add_crs` with one plain CRS), so this is the unit test on the comparison helper the
    ruling allows as a fallback."""
    horizontal = CRS.from_epsg(32639)
    vertical = CRS.from_epsg(5773)  # EGM96 height, an arbitrary vertical CRS
    compound = CRS.from_user_input(
        f'COMPOUNDCRS["WGS84 UTM 39N + EGM96",{horizontal.to_wkt()},{vertical.to_wkt()}]'
    )
    assert compound.to_epsg() is None
    assert export._horizontal_epsg(compound) == 32639
    assert export._horizontal_epsg(horizontal) == 32639
    assert export._horizontal_epsg(None) is None
