"""GET/PATCH /images/{imageId} -> ImageDetail, and the metadata refresh (spec §14)."""

import math

import pytest
from imagery_camera_helpers import dji_jpeg

API = "/api/v1/projects/{pid}/images"


@pytest.fixture
def image_id(client, project_id, import_source, tmp_path) -> str:
    dji_jpeg(tmp_path / "f" / "DJI_0001.jpg")
    import_source(project_id, tmp_path / "f")
    return client.get(API.format(pid=project_id)).json()["items"][0]["id"]


def test_get_returns_image_detail(client, project_id, image_id):
    r = client.get(f"{API.format(pid=project_id)}/{image_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == image_id and body["file_name"] == "DJI_0001.jpg"  # still an Image
    cam = body["camera"]
    assert cam["distance_source"] == "rel_alt" and cam["distance_sigma_m"] == 1.0
    assert cam["distance_m"] == pytest.approx(38.4 / math.cos(math.radians(0.1)))
    assert cam["gsd_mm"] == pytest.approx(cam["distance_m"] * 1000 / (3666.666504 * 800 / 5280))
    assert cam["camera_model"] == "M3E" and cam["focal_px"] == 3666.666504
    assert body["footprint_kind"] == "trapezoid"
    ring = body["footprint"]["coordinates"][0]
    assert body["footprint"]["type"] == "Polygon" and len(ring) == 5 and ring[0] == ring[-1]


def test_patch_distance_sets_and_clears(client, project_id, image_id):
    url = f"{API.format(pid=project_id)}/{image_id}"
    r = client.patch(url, json={"subject_distance_m": 12.5})
    assert r.status_code == 200, r.text
    cam = r.json()["camera"]
    assert (cam["subject_distance_m"], cam["distance_source"], cam["distance_sigma_m"]) == (
        12.5,
        "manual",
        0.0,
    )
    assert cam["gsd_mm"] == pytest.approx(12.5 * 1000 / (3666.666504 * 800 / 5280))
    cleared = client.patch(url, json={"subject_distance_m": None}).json()["camera"]
    assert cleared["subject_distance_m"] is None and cleared["distance_source"] == "rel_alt"


def test_patch_marked_empty_still_works_and_leaves_distance(client, project_id, image_id):
    url = f"{API.format(pid=project_id)}/{image_id}"
    client.patch(url, json={"subject_distance_m": 9.0})
    body = client.patch(url, json={"marked_empty": True}).json()
    assert body["marked_empty"] is True and body["camera"]["subject_distance_m"] == 9.0


@pytest.mark.parametrize("bad", [0, -1, 20000])
def test_patch_rejects_out_of_range_distance(client, project_id, image_id, bad):
    r = client.patch(f"{API.format(pid=project_id)}/{image_id}", json={"subject_distance_m": bad})
    assert r.status_code == 422


@pytest.mark.parametrize("body", [{}, {"marked_empty": None}])
def test_patch_rejects_empty_and_null(client, project_id, image_id, body):
    r = client.patch(f"{API.format(pid=project_id)}/{image_id}", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_unknown_image_is_404(client, project_id):
    assert client.get(f"{API.format(pid=project_id)}/nope").status_code == 404
    assert (
        client.patch(f"{API.format(pid=project_id)}/nope", json={"subject_distance_m": 3}).status_code == 404
    )


def test_image_without_camera_data(client, project_id, import_source, tmp_path):
    dji_jpeg(tmp_path / "p" / "IMG.jpg", xmp=None, focal_mm=None, orig=None, lat=None, lon=None)
    import_source(project_id, tmp_path / "p")
    iid = client.get(API.format(pid=project_id)).json()["items"][0]["id"]
    body = client.get(f"{API.format(pid=project_id)}/{iid}").json()
    assert body["camera"]["distance_source"] == "none" and body["camera"]["distance_m"] is None
    assert body["camera"]["gsd_mm"] is None
    assert body["footprint"] is None and body["footprint_kind"] == "none"


def test_metadata_refresh_queues_the_job(client, project_id, image_id, wait_job):
    r = client.post(f"{API.format(pid=project_id)}/metadata-refresh")
    assert r.status_code == 202, r.text
    job = r.json()["job"]  # JobRef
    assert job["type"] == "image_metadata" and job["params"] == {"force": True}
    assert wait_job(project_id, job["id"])["result"] == {"images": 1, "updated": 1, "skipped": 0}


def test_metadata_refresh_409_while_live(client, handle, project_id, image_id):
    from app.db.models import Job

    with handle.session() as s:
        live = Job(type="image_metadata", params={}, state="queued", log_path="runs/x/job.log")
        s.add(live)
        s.flush()
        live_id = live.id
    r = client.post(f"{API.format(pid=project_id)}/metadata-refresh")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"] == {"job_id": live_id}
