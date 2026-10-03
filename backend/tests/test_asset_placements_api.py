# backend/tests/test_asset_placements_api.py
"""The placements API (spec 2026-10-02-asset-findings §8; plan J3 Task 6)."""

import pytest
from asset_place_helpers import add_photo, add_sighting, diamond, project_truth, seed_model
from fixtures.synthetic_tower import make_tower
from test_asset_place_job import Ctx

from app.asset_review import jobs_place, place
from app.asset_review.meshes import load_glb_mesh
from app.asset_review.profiles import resolve
from app.db.models import Job

API = "/api/v1/projects"


@pytest.fixture(scope="module")
def tower(tmp_path_factory):
    return make_tower(tmp_path_factory.mktemp("tower"), photos=False)


@pytest.fixture(scope="module")
def truth(tower):
    mesh, _ = load_glb_mesh(tower.glb_path)
    return project_truth(tower, mesh)


def seeded(handle, tower, items, type_id, polygons=()):
    mid = seed_model(handle, tower.glb_path, tower.frame, resolve("building_facade", tower.frame.height_m))
    photos, sids = {}, []
    for k, ts in enumerate(items):
        if ts.pose_index not in photos:
            photos[ts.pose_index] = add_photo(
                handle, mid, f"q{ts.pose_index:03d}.jpg", tower.poses[ts.pose_index]
            )
        shape = diamond(ts.shape) if k in polygons else ts.shape
        sids.append(add_sighting(handle, mid, type_id, photos[ts.pose_index], shape))
    return mid, sids


@pytest.fixture
def placed(handle, tower, truth, crack):
    mid, sids = seeded(handle, tower, truth[:5], crack["id"], polygons={0})
    jobs_place.run_place(Ctx(handle, {"asset_model_id": mid}))
    return mid, sids


def test_placements_page_with_the_version(client, project_id, placed, crack):
    mid, sids = placed
    url = f"{API}/{project_id}/asset-models/{mid}/placements"
    first = client.get(url, params={"limit": 2}).json()
    assert first["version"] == 1 and len(first["items"]) == 2
    assert first["next"] == first["items"][-1]["sighting_id"]
    second = client.get(url, params={"limit": 2, "after": first["next"]}).json()
    rest = client.get(url, params={"after": second["next"]}).json()
    assert rest["next"] is None
    items = first["items"] + second["items"] + rest["items"]
    assert sorted(i["sighting_id"] for i in items) == sorted(sids)
    patch = next(i for i in items if i["kind"] == "patch")
    assert patch["sighting_id"] == sids[0] and patch["has_patch"] is True and patch["size"] > 0
    assert patch["type_id"] == crack["id"]
    pin = next(i for i in items if i["kind"] == "point")
    assert pin["size"] == 0 and pin["has_patch"] is False and pin["severity"] == 2
    assert len(pin["center"]) == 3 and len(pin["normal"]) == 3 and pin["finding_id"] is None
    assert client.get(url, params={"limit": 2001}).status_code == 422
    assert client.get(url, params={"limit": 0}).status_code == 422


def test_patch_binaries_carry_an_etag_and_answer_304(client, project_id, placed):
    mid, sids = placed
    base = f"{API}/{project_id}/asset-models/{mid}/placements/{sids[0]}"
    mesh = client.get(f"{base}/mesh")
    assert mesh.status_code == 200 and mesh.headers["content-type"] == "application/octet-stream"
    pos, uv = place.decode_patch(mesh.content)
    assert len(pos) == len(uv) > 0
    etag = mesh.headers["etag"]
    again = client.get(f"{base}/mesh", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.headers["etag"] == etag
    tex = client.get(f"{base}/texture")
    assert tex.headers["content-type"] == "image/png" and tex.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert place.decode_labels(client.get(f"{base}/labels").content).max() == 1


def test_binaries_are_404_for_a_pin_an_unknown_sighting_or_model(client, project_id, placed):
    mid, sids = placed
    root = f"{API}/{project_id}/asset-models/{mid}/placements"
    assert client.get(f"{root}/{sids[1]}/mesh").status_code == 404  # a pin has no patch
    assert client.get(f"{root}/nope/texture").status_code == 404
    assert client.get(f"{API}/{project_id}/asset-models/nope/placements").status_code == 404


def test_compute_queues_the_job_and_refuses_a_second(
    client, project_id, handle, tower, truth, crack, wait_job
):
    mid, _ = seeded(handle, tower, truth[:2], crack["id"])
    url = f"{API}/{project_id}/asset-models/{mid}/placements/compute"
    r = client.post(url, json={"only_dirty": False})
    assert r.status_code == 202 and r.json()["job"]["type"] == "asset_place"
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded" and job["result"]["point"] == 2
    with handle.session() as s:
        s.add(Job(type="asset_place", state="running", params={"asset_model_id": mid}))
    busy = client.post(url, json={})
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "job_running"
    with handle.session() as s:
        s.query(Job).delete()
        s.add(Job(type="asset_group", state="running", params={"asset_model_id": mid}))
    grouping = client.post(url, json={})
    assert grouping.status_code == 409 and grouping.json()["error"]["code"] == "job_running"
    assert client.post(f"{API}/{project_id}/asset-models/nope/placements/compute", json={}).status_code == 404
