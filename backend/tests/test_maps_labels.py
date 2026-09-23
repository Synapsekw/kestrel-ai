"""Zones, labels, seeding from a run, and a run's score through the API (spec section 8)."""

import re

import pytest
from geotiffs import make_squares_geotiff
from sqlalchemy import event
from test_maps_detect import SQUARES, SquareProvider, run_body, start  # reuse the detect fixtures' helpers

BASE = "/api/v1/projects"
ZONE = [[0, 0], [1500, 0], [1500, 1500], [0, 1500]]  # holds squares 1 and 2 of SQUARES


@pytest.fixture
def ready_map(client, project_id, wait_job, tmp_path):
    path = make_squares_geotiff(tmp_path / "sq.tif", 3000, 1500, SQUARES)
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    return r.json()["map"]["id"]


@pytest.fixture
def run_id(client, project_id, wait_job, ready_map, monkeypatch, app):
    app.state.keys.set("anthropic", "sk-fake-key")
    monkeypatch.setattr("app.maps.jobs_detect.get_provider", lambda *a, **k: SquareProvider())
    rid, _ = start(client, project_id, wait_job, run_body(ready_map))
    return rid


def test_zone_crud_bumps_labels_version(client, project_id, ready_map):
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    v0 = client.get(url).json()["labels_version"]
    z = client.post(f"{url}/zones", json={"name": "Zone 1", "polygon": ZONE})
    assert z.status_code == 201
    zid = z.json()["id"]
    assert client.patch(f"{url}/zones/{zid}", json={"name": "North"}).json()["name"] == "North"
    assert [i["name"] for i in client.get(f"{url}/zones").json()["items"]] == ["North"]
    assert client.delete(f"{url}/zones/{zid}").status_code == 204
    assert client.get(url).json()["labels_version"] == v0 + 3


def test_label_crud_and_unknown_class(client, project_id, ready_map, project):
    url = f"{BASE}/{project_id}/maps/{ready_map}/labels"
    cls = project["classes"][0]["id"]
    lab = client.post(url, json={"class_id": cls, "x": 200, "y": 200, "w": 60, "h": 60})
    assert lab.status_code == 201 and lab.json()["source"] == "manual"
    lid = lab.json()["id"]
    assert client.patch(f"{url}/{lid}", json={"w": 70}).json()["w"] == 70
    assert client.post(url, json={"class_id": "nope", "x": 1, "y": 1, "w": 1, "h": 1}).status_code == 422
    assert (
        client.post(url, json={"class_id": cls, "x": 2990, "y": 1, "w": 50, "h": 5}).status_code == 422
    )  # off the map
    assert client.delete(f"{url}/{lid}").status_code == 204
    assert client.get(url).json()["items"] == []


def test_seed_then_edit_then_score(client, project_id, ready_map, run_id, project):
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    zid = client.post(f"{url}/zones", json={"name": "Z", "polygon": ZONE}).json()["id"]
    r = client.post(f"{url}/labels/seed", json={"run_id": run_id, "zone_id": zid})
    assert r.status_code == 200 and r.json()["created"] == 2
    labels = client.get(f"{url}/labels").json()["items"]
    assert {lab["source"] for lab in labels} == {f"from_run:{run_id}"}
    edited = client.patch(f"{url}/labels/{labels[0]['id']}", json={"x": labels[0]["x"] + 1}).json()
    assert edited["source"] == "manual"

    s = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s["has_zones"] and s["overall"]["tp"] == 2 and s["overall"]["fp"] == 0 and s["overall"]["fn"] == 0
    # a label the run never found: one miss, recall 2/3
    cls = project["classes"][0]["id"]
    client.post(f"{url}/labels", json={"class_id": cls, "x": 800, "y": 800, "w": 60, "h": 60})
    s2 = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s2["overall"]["fn"] == 1 and s2["overall"]["recall"] == pytest.approx(2 / 3)
    assert s2["labels_version"] > s["labels_version"]


def test_score_without_zones(client, project_id, run_id):
    s = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert s["has_zones"] is False and s["overall"]["predicted"] == 0


def test_score_with_no_zones_never_queries_detections_or_labels(client, project_id, run_id, handle):
    """The no-zones path must short-circuit before loading rows: a spy on the SQL that actually
    reaches the database, not just an assertion on the answer, so a regression that loads-then-
    discards would still fail this test."""
    seen: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    event.listen(handle.engine, "before_cursor_execute", _capture)
    try:
        r = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score")
    finally:
        event.remove(handle.engine, "before_cursor_execute", _capture)
    assert r.status_code == 200 and r.json()["has_zones"] is False
    # word-boundary, not substring: `geo_map.labels_version` must not count as `map_label`
    touched = re.compile(r"\bmap_detection\b|\bmap_label\b", re.IGNORECASE)
    assert not any(touched.search(s) for s in seen)


def test_far_outside_detection_is_still_excluded_from_the_score(client, project_id, ready_map, run_id):
    """Squares 3 and 4 sit outside `ZONE`; the bbox narrowing in `score_run` must not change which
    boxes end up in the score, only how many rows are fetched to get there."""
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    client.post(f"{url}/zones", json={"name": "Z", "polygon": ZONE})
    dets = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/detections").json()["items"]
    outside_ids = {d["id"] for d in dets if d["x"] >= 1500}
    assert outside_ids
    s = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").json()
    assert not (outside_ids & {m["id"] for m in s["matches"]})


def test_score_over_the_cap_is_409(client, project_id, ready_map, run_id, monkeypatch):
    """A zone covering the whole map is a pathological case the bbox narrowing cannot help with;
    the hard cap must refuse to score rather than silently truncate and report a wrong precision."""
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    whole = [[0, 0], [3000, 0], [3000, 1500], [0, 1500]]
    client.post(f"{url}/zones", json={"name": "All", "polygon": whole})
    monkeypatch.setattr("app.maps.service.MAX_DETECTIONS", 1)
    assert client.get(f"{BASE}/{project_id}/map-runs/{run_id}/score").status_code == 409


def test_seeding_twice_does_not_duplicate_labels(client, project_id, ready_map, run_id):
    url = f"{BASE}/{project_id}/maps/{ready_map}"
    zid = client.post(f"{url}/zones", json={"name": "Z", "polygon": ZONE}).json()["id"]
    body = {"run_id": run_id, "zone_id": zid}
    first = client.post(f"{url}/labels/seed", json=body)
    assert first.json()["created"] == 2
    count = len(client.get(f"{url}/labels").json()["items"])
    second = client.post(f"{url}/labels/seed", json=body)
    assert second.json()["created"] == 0
    assert len(client.get(f"{url}/labels").json()["items"]) == count
