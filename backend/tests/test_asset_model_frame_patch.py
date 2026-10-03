"""PATCH /asset-models/{id} with frame and review (spec §5.1, §8)."""

import pytest

BASE = "/api/v1/projects/{pid}/asset-models"
FRAME = {
    "origin": {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0},
    "north_offset_deg": 12.5,
    "height_m": 42.0,
    "datum_label": "Ground",
    "datum_note": "Top of foundation slab",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 3.0], [42.0, 0.9]],
    "levels": [30.0, 36.0],
    "presets": [],
}


@pytest.fixture
def url(client, project_id):
    r = client.post(BASE.format(pid=project_id), json={"name": "Tower"})
    assert r.status_code == 201
    m = r.json()
    assert m["frame"] is None and m["review"] is None
    return f"{BASE.format(pid=project_id)}/{m['id']}"


def test_patch_frame_round_trips(client, url):
    r = client.patch(url, json={"frame": FRAME})
    assert r.status_code == 200, r.text
    got = client.get(url).json()["frame"]
    assert {k: got[k] for k in FRAME} == FRAME


def test_patch_frame_null_clears_it(client, url):
    client.patch(url, json={"frame": FRAME})
    assert client.patch(url, json={"frame": None}).json()["frame"] is None


def test_a_malformed_frame_is_422(client, url):
    r = client.patch(url, json={"frame": {**FRAME, "height_m": "tall"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get(url).json()["frame"] is None


def test_review_resolves_the_profile_against_the_height(client, url):
    client.patch(url, json={"frame": FRAME})
    r = client.patch(url, json={"review": {"profile_id": "telecom_tower"}})
    assert r.status_code == 200, r.text
    review = r.json()["review"]
    assert review["profile_id"] == "telecom_tower"
    assert {z["id"] for z in review["zones"]} == {"antenna", "body", "base"}
    body = next(z for z in review["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(4.2) and body["max_m"] == pytest.approx(33.6)


def test_review_and_frame_in_one_patch(client, url):
    r = client.patch(url, json={"frame": FRAME, "review": {"profile_id": "stack"}})
    assert r.status_code == 200 and r.json()["review"]["profile_id"] == "stack"


def test_review_refusals(client, url):
    r = client.patch(url, json={"review": {"profile_id": "stack"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "frame_required"
    client.patch(url, json={"frame": FRAME})
    r = client.patch(url, json={"review": {"profile_id": "pylon"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_profile"
    r = client.patch(url, json={"review": {"name": "no profile id"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_profile"


def test_a_height_change_rescales_the_review(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "telecom_tower"}})
    r = client.patch(url, json={"frame": {**FRAME, "height_m": 84.0}})
    body = next(z for z in r.json()["review"]["zones"] if z["id"] == "body")
    assert body["min_m"] == pytest.approx(8.4) and body["max_m"] == pytest.approx(67.2)


def test_an_explicit_review_with_a_height_change_is_resolved_not_rescaled(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "telecom_tower"}})
    r = client.patch(
        url, json={"frame": {**FRAME, "height_m": 84.0}, "review": {"profile_id": "telecom_tower"}}
    )
    assert r.status_code == 200, r.text
    body = next(z for z in r.json()["review"]["zones"] if z["id"] == "body")
    # Resolved once against 84 m (10 % .. 80 %), not 4.2..33.6 scaled a second time.
    assert body["min_m"] == pytest.approx(8.4) and body["max_m"] == pytest.approx(67.2)


def test_clearing_the_frame_clears_the_stale_review(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "stack"}})
    r = client.patch(url, json={"frame": None})
    assert r.status_code == 200 and r.json()["frame"] is None and r.json()["review"] is None


def test_review_null_clears_it_and_a_rename_keeps_both(client, url):
    client.patch(url, json={"frame": FRAME, "review": {"profile_id": "stack"}})
    r = client.patch(url, json={"name": "Stack 2"})
    assert r.json()["name"] == "Stack 2" and r.json()["review"]["profile_id"] == "stack"
    assert client.patch(url, json={"review": None}).json()["review"] is None
