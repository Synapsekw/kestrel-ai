"""The poses API (spec §8): keyset list (max 2,000), estimate job, manual pose."""

import pytest

from app.db.models import AssetModel, Image, ImagePose, ImageReview, Source

BASE = "/api/v1/projects/{pid}/asset-models"
LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
FRAME = {
    "origin": {"lat": LAT0, "lon": LON0, "ground_alt_m": ALT0},
    "north_offset_deg": 0.0,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [],
    "levels": [],
    "presets": [],
}
MANUAL = {
    "position": [10.0, 5.0, 0.0],
    "target": [0.0, 5.0, 0.0],
    "up": [0.0, 1.0, 0.0],
    "hfov_deg": 60.0,
    "vfov_deg": 45.0,
    "accuracy_m": 0.5,
    "sequence": "hand placed",
}


@pytest.fixture
def model_url(client, project_id, handle):
    r = client.post(BASE.format(pid=project_id), json={"name": "Tower"})
    mid = r.json()["id"]
    with handle.session() as s:
        s.get(AssetModel, mid).frame = FRAME
    return f"{BASE.format(pid=project_id)}/{mid}", mid


def seed_images(handle, n, **cols):
    with handle.session() as s:
        src = Source(folder="C:/photos", site="Site A", label="Flight 1")
        s.add(src)
        s.flush()
        rows = [
            Image(path=f"images/p{i:05d}.jpg", width=4000, height=3000, source_id=src.id, **cols)
            for i in range(n)
        ]
        s.add_all(rows)
        s.flush()
        return [r.id for r in rows]


def test_estimate_then_list(client, model_url, handle, project_id, wait_job):
    url, mid = model_url
    a, b = seed_images(handle, 2, lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0, gimbal_pitch=-30.0)
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "succeeded" and job["type"] == "asset_pose"
    assert job["result"]["posed"] == 2 and job["result"]["skipped"] == 0
    with handle.session() as s:
        s.add(ImageReview(image_id=a, status="uncertain", note=""))
    body = client.get(f"{url}/poses").json()
    assert body["next"] is None and [i["image_id"] for i in body["items"]] == sorted([a, b])
    item = next(i for i in body["items"] if i["image_id"] == a)
    assert item["source"] == "exif_gimbal" and item["position"] == [11.1319, 20.0, 0.0]
    assert item["hfov_deg"] == 70.0 and item["sequence"] == "Flight 1" and item["accuracy_m"] == 3.0
    assert item["outcome"] == "uncertain"
    assert next(i for i in body["items"] if i["image_id"] == b)["outcome"] == "not_assessed"


def test_estimate_a_chosen_set(client, model_url, handle, project_id, wait_job):
    url, _ = model_url
    a, _b = seed_images(handle, 2, lat=LAT0 + 0.0001, lon=LON0, alt=25.0)
    r = client.post(f"{url}/poses/estimate", json={"image_ids": [a]})
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["result"]["total"] == 1 and job["result"]["axis_aimed"] == 1
    assert [i["image_id"] for i in client.get(f"{url}/poses").json()["items"]] == [a]


def test_list_pages_by_image_id_at_most_2000(client, model_url, handle):
    url, mid = model_url
    ids = sorted(seed_images(handle, 2005))
    with handle.session() as s:
        s.add_all(
            ImagePose(
                image_id=i,
                asset_model_id=mid,
                source="exif_gimbal",
                sequence="s1" if n % 2 else "s2",
                **{k: MANUAL[k] for k in ("position", "target", "up", "hfov_deg", "vfov_deg")},
            )
            for n, i in enumerate(ids)
        )
    assert len(client.get(f"{url}/poses").json()["items"]) == 500  # the contract's default page
    first = client.get(f"{url}/poses", params={"limit": 2000}).json()
    assert len(first["items"]) == 2000 and first["next"] == ids[1999]
    second = client.get(f"{url}/poses", params={"after": first["next"], "limit": 2000}).json()
    assert [i["image_id"] for i in second["items"]] == ids[2000:] and second["next"] is None
    small = client.get(f"{url}/poses", params={"limit": 3, "sequence": "s1"}).json()
    assert [i["image_id"] for i in small["items"]] == ids[1:7:2] and small["next"] == ids[5]
    only = client.get(f"{url}/poses", params={"image_id": [ids[3], ids[10]]}).json()
    assert [i["image_id"] for i in only["items"]] == [ids[3], ids[10]]
    assert client.get(f"{url}/poses", params={"limit": 2001}).status_code == 422
    assert client.get(f"{url}/poses", params={"limit": 0}).status_code == 422


def test_estimate_without_origin_is_422(client, model_url, handle):
    url, mid = model_url
    with handle.session() as s:
        s.get(AssetModel, mid).frame = {**FRAME, "origin": None}
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_origin"
    with handle.session() as s:
        s.get(AssetModel, mid).frame = None
    assert client.post(f"{url}/poses/estimate").json()["error"]["code"] == "no_origin"


def test_estimate_while_one_is_live_is_409(client, model_url, monkeypatch):
    import app.asset_review.routes_poses as rp

    url, _ = model_url
    monkeypatch.setattr(rp, "live_pose_job", lambda *_a: "job-1")
    r = client.post(f"{url}/poses/estimate", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"]["job_id"] == "job-1"


def test_manual_pose_upserts_and_survives_an_estimate(client, model_url, handle, project_id, wait_job):
    url, _ = model_url
    [a] = seed_images(handle, 1, lat=LAT0 + 0.0001, lon=LON0, alt=25.0, gimbal_yaw=180.0)
    r = client.put(f"{url}/poses/{a}", json=MANUAL)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (
        out["source"] == "manual" and out["position"] == [10.0, 5.0, 0.0] and out["sequence"] == "hand placed"
    )
    assert out["outcome"] == "not_assessed"
    again = client.put(f"{url}/poses/{a}", json={**MANUAL, "position": [12.0, 5.0, 0.0]}).json()
    assert again["position"] == [12.0, 5.0, 0.0]
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    assert job["result"]["kept"] == 1 and job["result"]["posed"] == 0
    assert client.get(f"{url}/poses").json()["items"][0]["position"] == [12.0, 5.0, 0.0]


def test_manual_pose_refusals(client, model_url, handle, project_id):
    url, _ = model_url
    [a] = seed_images(handle, 1)
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "target": MANUAL["position"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "up": [-1.0, 0.0, 0.0]})  # up along the view
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "hfov_deg": 180.0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pose"
    r = client.put(f"{url}/poses/{a}", json={**MANUAL, "hfov_deg": 0.0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.put(f"{url}/poses/missing", json=MANUAL).status_code == 404
    other = f"{BASE.format(pid=project_id)}/missing/poses/{a}"
    assert client.put(other, json=MANUAL).status_code == 404
    assert client.get(f"{BASE.format(pid=project_id)}/missing/poses").status_code == 404


def test_synthetic_tower_photos_pose_from_their_exif(
    client, project_id, handle, tmp_path, import_source, wait_job
):
    """The tower's 32 photos, imported for real (EXIF GPS and focal, DJI XMP gimbal yaw, pitch and
    roll), pose back to the tower's true cameras."""
    from fixtures.synthetic_tower import make_tower

    tower = make_tower(tmp_path, photos=True)
    mid = client.post(BASE.format(pid=project_id), json={"name": "Synthetic tower"}).json()["id"]
    with handle.session() as s:
        s.get(AssetModel, mid).frame = tower.frame.model_dump(mode="json")
    # The synthetic views look alike, so the importer's near-duplicate filter drops a few of the 32
    # (even at threshold 0, identical hashes still collapse): pose and check every photo that landed.
    import_source(project_id, tower.photos_dir, settings={"dedupe_threshold": 0})
    url = f"{BASE.format(pid=project_id)}/{mid}"
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    with handle.session() as s:
        by_name = {im.original_name: im.id for im in s.query(Image)}
    assert len(by_name) >= 24
    assert job["state"] == "succeeded" and job["result"]["posed"] == len(by_name), job["result"]
    items = {i["image_id"]: i for i in client.get(f"{url}/poses").json()["items"]}
    assert len(items) == len(by_name)
    for p in tower.poses:
        if p["name"] not in by_name:
            continue
        item = items[by_name[p["name"]]]
        assert item["position"] == pytest.approx(p["position"], abs=0.02)
        assert item["target"] == pytest.approx(p["target"], abs=0.05)
        assert item["up"] == pytest.approx(p["up"], abs=1e-3)
        assert item["hfov_deg"] == pytest.approx(p["hfov"], abs=0.01)  # 35 mm rule via sensor_w_mm


def test_imported_photos_flow_from_exif_columns(
    client, model_url, project_id, tmp_path, make_jpeg, import_source, wait_job
):
    """The real import path: GPS and lens columns reach the pose; a photo without GPS is reported."""
    url, _ = model_url
    folder = tmp_path / "photos"
    make_jpeg(
        folder / "with_gps.jpg",
        400,
        300,
        seed=1,
        exif={"lat": LAT0 + 0.0001, "lon": LON0, "alt": 25.0, "focal_mm": 8.8, "focal_35mm": 24},
    )
    make_jpeg(folder / "no_gps.jpg", 400, 300, seed=2)
    import_source(project_id, folder)
    job = wait_job(project_id, client.post(f"{url}/poses/estimate", json={}).json()["job"]["id"])
    result = job["result"]
    assert result["axis_aimed"] == 1 and result["skipped"] == 1  # no XMP yaw: aims at the axis
    assert result["skipped_images"][0]["reason"] == "no_gps"
    [item] = client.get(f"{url}/poses").json()["items"]
    assert item["position"] == pytest.approx([11.1319, 20.0, 0.0], abs=0.01)
    assert item["hfov_deg"] == pytest.approx(73.7398, abs=1e-3)  # sensor 36 * 8.8 / 24 = 13.2 mm
