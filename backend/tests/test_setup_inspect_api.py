"""S1-U3 API (spec §7.1, index ruling S-R3): POST /setup/inspect runs `setup_inspect` on the
library handle, read through /library/jobs; 503 without the library; cancel through /library/jobs."""

import threading

import pytest
from geotiffs import make_geotiff
from imagery_camera_helpers import dji_jpeg
from library_helpers import LIB, wait_library_job
from setup_inspect_helpers import THERMAL_XMP, VISUAL_XMP, CountingReader, touch_files

from app.setup import inspect_job
from app.setup.schemas import InspectResult

URL = "/api/v1/setup/inspect"


@pytest.fixture
def live_inspect(app, monkeypatch):
    monkeypatch.setattr(inspect_job, "run_pipeline", inspect_job._run_pipeline)


def start(client, paths, **body) -> dict:
    r = client.post(URL, json={"paths": [str(p) for p in paths], **body})
    assert r.status_code == 202, r.text
    return r.json()["job"]


def test_a_delivery_folder_is_sorted_on_the_library(client, live_inspect, tmp_path):
    root = tmp_path / "delivery"
    make_geotiff(root / "maps" / "ortho.tif", 64, 48)
    make_geotiff(root / "maps" / "dsm.tif", 64, 48, count=1, dtype="float32")
    dji_jpeg(root / "DCIM" / "DJI_20260930101500_0001_V.JPG", size=(64, 48), xmp=VISUAL_XMP)
    dji_jpeg(root / "DCIM" / "DJI_20260930101500_0002_T.JPG", size=(64, 48), xmp=THERMAL_XMP)
    (root / "Thumbs.db").write_bytes(b"\0")

    job = start(client, [root], template_id="builtin-vertical")
    assert (job["project_id"], job["type"]) == ("library", "setup_inspect")
    done = wait_library_job(client, job["id"])
    assert done["state"] == "succeeded", done["error"]

    result = InspectResult.model_validate(done["result"])
    got = sorted((b.route, b.match.raster or "", bool(b.match.thermal), b.count) for b in result.buckets)
    assert got == [
        ("elevation", "elevation", False, 1),
        ("images", "", False, 1),
        ("images", "", True, 1),
        ("map", "ortho", False, 1),
    ]
    images = [b for b in result.buckets if b.route == "images"]
    assert all(b.slot_key for b in images) and images[0].slot_key != images[1].slot_key
    assert all(b.folder == str(root / "DCIM") for b in images)
    assert [s.name for s in result.not_recognised.samples] == ["Thumbs.db"]
    # Mapping fills Orthomosaic (required) plus Elevation and Raw images: (1, 3) beats Vertical's (1, 2).
    assert result.suggested_template_id == "builtin-mapping"
    assert result.truncated is False


def test_a_missing_path_is_a_not_recognised_row_not_a_failure(client, live_inspect, tmp_path):
    gone = tmp_path / "unplugged"
    done = wait_library_job(client, start(client, [gone])["id"])
    assert done["state"] == "succeeded"
    assert done["result"]["not_recognised"] == {
        "count": 1,
        "samples": [{"name": str(gone), "reason": "not found"}],
    }


def test_without_the_library_it_is_503(app, client, tmp_path):
    app.state.library = None
    r = client.post(URL, json={"paths": [str(tmp_path)]})
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_the_body_is_validated(client):
    assert client.post(URL, json={"paths": []}).status_code == 422
    assert client.post(URL, json={"paths": ["E:\\a"] * 17}).status_code == 422
    assert client.post(URL, json={"paths": ["E:\\a"], "extra": 1}).status_code == 422


def test_generated_requests_never_walk_a_drive(client, tmp_path):
    """Without `live_inspect` the shared fixture's seam fails the job before any walk."""
    done = wait_library_job(client, start(client, [tmp_path])["id"])
    assert (done["state"], done["error"]) == ("failed", "Folder inspection is disabled in tests.")


def test_cancel_through_library_jobs(client, live_inspect, tmp_path, monkeypatch):
    started, release = threading.Event(), threading.Event()

    class Blocking(CountingReader):
        def raster(self, path):
            started.set()
            release.wait(10)
            return super().raster(path)

    monkeypatch.setattr(inspect_job, "reader_factory", Blocking)
    touch_files(tmp_path / "maps", ["a.tif", "b.tif", "c.tif"])
    job = start(client, [tmp_path / "maps"])
    assert started.wait(10)
    r = client.post(f"{LIB}/jobs/{job['id']}/cancel")
    assert r.status_code == 200, r.text
    release.set()
    done = wait_library_job(client, job["id"])
    assert (done["state"], done["result"]) == ("cancelled", None)
