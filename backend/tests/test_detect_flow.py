"""The detection workspace end to end (plan 2 unit X), through the API only: a detection project gets
a photo batch and a map, one run per source with a library model (its unknown class mapped once),
review on both, a site area, and then the analytics, a recount and the CSV export all agree."""

import csv

import pytest
from geotiffs import make_squares_geotiff
from library_helpers import add_library_model

from app.providers.base import Detection, TileResult

BASE = "/api/v1/projects"


class ModelLikeProvider:
    """One detection per mapped model class on every tile, translated through the run's class map
    the way `LocalYoloProvider` does: a class the map ignores is never emitted."""

    name = "fake"

    def __init__(self, model_classes, class_map):
        self.model_classes, self.class_map = model_classes, class_map

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        dets = []
        for i, name in enumerate(self.model_classes):
            label = self.class_map.get(name)
            if label is not None:
                dets.append(Detection(label, tile.x + 10 + 60 * i, tile.y + 10, 20, 20, 0.9 - i / 10))
        return TileResult(tile=tile, detections=dets)


@pytest.fixture
def fake_model(monkeypatch):
    def factory(kind, **kw):
        return ModelLikeProvider(kw["model_row"].class_names, kw["class_map"])

    monkeypatch.setattr("app.inference.jobs.get_provider", factory)
    monkeypatch.setattr("app.maps.jobs_detect.get_provider", factory)


def _ok(job: dict) -> dict:
    assert job["state"] == "succeeded", job
    return job


def _source_numbers(client, project_id, source_id) -> dict:
    """What Analytics says about one source: its unit, its run, per-class (total, verified), review."""
    body = client.get(f"{BASE}/{project_id}/analytics/sources/{source_id}").json()
    return {
        "unit": body["unit"],
        "run": body["run"]["id"],
        "classes": {c["name"]: (c["total"], c["verified"]) for c in body["classes"]},
        "review": body["review"],
    }


def test_a_detection_project_from_sources_to_a_csv(
    client, app, project_id, tmp_path, make_jpeg, import_source, wait_job, fake_model
):
    # --- Sources: a photo batch and a map, each dated.
    photos = tmp_path / "flight"
    for i in range(3):
        make_jpeg(photos / f"f_{i}.jpg", 320, 240, seed=i)
    photo_source = import_source(project_id, photos)
    tif = make_squares_geotiff(tmp_path / "may.tif", 1200, 800, [(200, 200, 60), (700, 400, 60)])
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(tif)})
    assert r.status_code == 202, r.text
    _ok(wait_job(project_id, r.json()["job"]["id"]))
    map_id = r.json()["map"]["id"]
    sources = {s["kind"]: s for s in client.get(f"{BASE}/{project_id}/sources").json()["items"]}
    assert set(sources) == {"images", "map"}
    map_source = sources["map"]["id"]
    assert sources["map"]["map_id"] == map_id
    for sid, day in ((photo_source, "2026-04-15"), (map_source, "2026-05-20")):
        r = client.patch(f"{BASE}/{project_id}/sources/{sid}", json={"captured_on": day})
        assert r.status_code == 200, r.text
    assert client.get(f"{BASE}/{project_id}/maps/{map_id}").json()["captured_on"] == "2026-05-20"

    # --- Runs: the model has a class the project lacks, so the first request asks for a mapping.
    model = add_library_model(app, tmp_path, name="site-v1", class_names=["excavator", "dump_truck", "car"])
    # Small windows so the map gets several detections, and some on each side of the area below.
    tiling = {"enabled": True, "tile_size": 512, "overlap": 0.0, "nms_iou": 0.5}
    body = {"source_ids": [photo_source, map_source], "model_id": model.id, "conf": 0.25, "tiling": tiling}
    r = client.post(f"{BASE}/{project_id}/runs", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["unmapped"] == ["car"]
    put = client.put(f"{BASE}/{project_id}/model-class-maps/{model.id}", json={"mapping": {"car": None}})
    assert put.status_code == 200, put.text
    r = client.post(f"{BASE}/{project_id}/runs", json=body)
    assert r.status_code == 202, r.text
    runs = {item["kind"]: item for item in r.json()["runs"]}
    for item in runs.values():
        _ok(wait_job(project_id, item["job"]["id"]))
    photo_run, map_run = runs["images"]["run_id"], runs["map"]["run_id"]

    listed = {x["id"]: x for x in client.get(f"{BASE}/{project_id}/runs").json()["items"]}
    assert set(listed) == {photo_run, map_run}
    # "car" was ignored: nothing outside the project's classes was kept.
    classes = {c["name"]: c["id"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]}
    assert "car" not in classes
    for run in listed.values():
        assert set(run["counts"]) <= {classes["excavator"], classes["dump_truck"]}
        assert run["counts"] and run["verified_counts"] == {}
        assert run["review"]["reviewed"] == 0

    # --- Review, on the map: accept one, reject one, make one a bulldozer.
    walk = []
    after = None
    for _ in range(3):
        params = {"after_id": after} if after else {}
        nxt = client.get(f"{BASE}/{project_id}/map-runs/{map_run}/next-unreviewed", params=params).json()
        walk.append(nxt["detection"])
        after = nxt["detection"]["id"]
    for det, action, extra in (
        (walk[0], "accept", {}),
        (walk[1], "reject", {}),
        (walk[2], "reclass", {"class_id": classes["bulldozer"]}),
    ):
        r = client.post(
            f"{BASE}/{project_id}/map-runs/{map_run}/review",
            json={"detection_ids": [det["id"]], "action": action, **extra},
        )
        assert r.status_code == 200, r.text

    # --- Review, on the photos: accept one box, reject another.
    image_id = client.get(f"{BASE}/{project_id}/images", params={"source_id": photo_source}).json()["items"][
        0
    ]["id"]
    boxes = client.get(f"{BASE}/{project_id}/images/{image_id}/boxes").json()["items"]
    proposals = [b for b in boxes if b.get("review_state") == "unreviewed"]
    assert len(proposals) >= 2
    for box, action in ((proposals[0], "accept"), (proposals[1], "reject")):
        r = client.post(f"{BASE}/{project_id}/boxes/review", json={"box_ids": [box["id"]], "action": action})
        assert r.status_code == 200, r.text

    # --- A site area over the left half of the map; creating it recounts the map runs.
    r = client.post(
        f"{BASE}/{project_id}/site-areas",
        json={"name": "West yard", "map_id": map_id, "polygon_px": [[0, 0], [600, 0], [600, 800], [0, 800]]},
    )
    assert r.status_code in (200, 201), r.text
    area_id = r.json()["id"]
    recounts = client.get(f"{BASE}/{project_id}/jobs", params={"type": "area_recount"}).json()["items"]
    for job in recounts:
        _ok(wait_job(project_id, job["id"]))

    # --- Analytics: the map reports objects, the photos detections, and review shows in both.
    before = {sid: _source_numbers(client, project_id, sid) for sid in (photo_source, map_source)}
    assert before[map_source]["unit"] == "objects" and before[map_source]["run"] == map_run
    assert before[photo_source]["unit"] == "detections" and before[photo_source]["run"] == photo_run
    assert before[map_source]["review"]["reviewed"] == 3
    assert before[photo_source]["review"]["reviewed"] == 2
    names = {v: k for k, v in classes.items()}
    # Verified: the accepted detection in its own class, and the one made a bulldozer.
    map_verified = {n: v for n, (_, v) in before[map_source]["classes"].items() if v}
    expected = {names[walk[0]["class_id"]]: 1}
    expected["bulldozer"] = expected.get("bulldozer", 0) + 1
    assert map_verified == expected
    assert sum(v for _, v in before[photo_source]["classes"].values()) == 1

    areas = client.get(f"{BASE}/{project_id}/analytics/areas").json()
    [survey] = areas["surveys"]
    cell = survey["per_area"][area_id]
    assert cell["partial"] is False
    dets = client.get(
        f"{BASE}/{project_id}/map-runs/{map_run}/detections", params={"bbox": "0,0,1200,800"}
    ).json()["items"]
    west = {}
    for d in dets:
        if d["review_state"] != "rejected" and d["x"] + d["w"] / 2 < 600:
            west[d["class_id"]] = west.get(d["class_id"], 0) + 1
    # The area holds some of the map's objects, not none and not all of them.
    assert 0 < sum(west.values()) < sum(1 for d in dets if d["review_state"] != "rejected")
    assert {c: v["total"] for c, v in cell["counts"].items() if v["total"]} == west

    # --- A recount rebuilds each run's counts from its detections: nothing moves.
    for run_id in (photo_run, map_run):
        r = client.post(f"{BASE}/{project_id}/runs/{run_id}/recount")
        assert r.status_code == 202, r.text
        _ok(wait_job(project_id, r.json()["job"]["id"]))
    after_recount = {sid: _source_numbers(client, project_id, sid) for sid in (photo_source, map_source)}
    assert after_recount == before

    # --- The CSV export carries the same numbers.
    r = client.post(f"{BASE}/{project_id}/detect-exports", json={"format": "csv"})
    assert r.status_code == 202, r.text
    job = _ok(wait_job(project_id, r.json()["job"]["id"]))
    handle = app.state.projects.get(project_id)
    [name] = job["result"]["files"]
    with (handle.folder / job["result"]["folder"] / name).open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    whole = {
        (row["source_kind"], row["class"]): (int(row["total"]), int(row["verified"]))
        for row in rows
        if row["area"] == ""
    }
    for sid, kind in ((photo_source, "images"), (map_source, "map")):
        for cls, numbers in before[sid]["classes"].items():
            if numbers != (0, 0):
                assert whole[(kind, cls)] == numbers, (kind, cls)
    in_area = {
        row["class"]: int(row["total"]) for row in rows if row["area"] == "West yard" and int(row["total"])
    }
    assert in_area == {names[c]: n for c, n in west.items()}
    photo_rows = [row for row in rows if row["source_kind"] == "images"]
    assert photo_rows and all(row["unit"] == "detections" and row["area"] == "" for row in photo_rows)
    assert all(row["survey_date"] == "2026-05-20" for row in rows if row["source_kind"] == "map")
