"""Detection across a whole map: windows, seams, nodata, GSD scaling, resume, queries (spec 6)."""

import cv2
import numpy as np
import pytest
from geotiffs import make_squares_geotiff

from app.db.models import MapDetection
from app.providers.base import Detection, ProviderError, TileResult

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Maps and query runs are detection work (spec 2026-09-23 section 5.2)."""
    return "detect"


SQUARES = [(200, 200, 60), (1250, 400, 60), (2500, 1000, 60), (2600, 300, 60)]  # 2nd sits on a seam


class SquareProvider:
    """Finds bright squares: one `excavator` per connected blob of pixels above 200."""

    name = "fake"

    def __init__(self, fail_windows=()):
        self.calls: list[int] = []
        self.fail_windows = set(fail_windows)

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        self.calls.append(tile.index)
        if tile.index in self.fail_windows:
            raise ProviderError("window is cursed", retryable=False)
        crop = np.asarray(image.crop((tile.x, tile.y, tile.x + tile.w, tile.y + tile.h)))[..., 0] > 200
        n, _, stats, _ = cv2.connectedComponentsWithStats(crop.astype(np.uint8))
        dets = [
            Detection("excavator", float(x + tile.x), float(y + tile.y), float(w), float(h), 0.9)
            for x, y, w, h, area in stats[1:n]
            if area >= 20
        ]
        return TileResult(tile=tile, detections=dets)


@pytest.fixture
def use_provider(monkeypatch):
    def _use(provider):
        monkeypatch.setattr("app.maps.jobs_detect.get_provider", lambda *a, **k: provider)
        return provider

    return _use


@pytest.fixture
def with_key(app):
    app.state.keys.set("anthropic", "sk-fake-key")


@pytest.fixture
def squares_map(client, project_id, wait_job, tmp_path):
    def _make(**kw):
        path = make_squares_geotiff(tmp_path / "sq.tif", 3000, 1500, SQUARES, **kw)
        r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
        assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
        return r.json()["map"]["id"]

    return _make


def run_body(map_id, **over):
    return {
        "map_id": map_id,
        "kind": "cloud_provider",
        "provider": "anthropic",
        "query": "excavators",
        **over,
    }


def start(client, project_id, wait_job, body):
    r = client.post(f"{BASE}/{project_id}/map-runs", json=body)
    assert r.status_code == 202, r.text
    return r.json()["run"]["id"], wait_job(project_id, r.json()["job"]["id"])


def test_every_square_is_counted_once_even_on_a_seam(
    client, project_id, wait_job, squares_map, use_provider, with_key, class_ids
):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, job = start(client, project_id, wait_job, run_body(map_id))
    assert job["state"] == "succeeded", job
    run = client.get(f"{BASE}/{project_id}/map-runs/{run_id}").json()
    assert run["state"] == "succeeded" and run["detection_count"] == 4
    assert run["counts"] == {class_ids["excavator"]: 4}
    boxes = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/detections").json()["items"]
    seam = [b for b in boxes if 1200 < b["x"] < 1300]
    assert len(seam) == 1 and seam[0]["w"] == pytest.approx(60, abs=4)


def test_nodata_windows_are_never_sent(client, project_id, wait_job, squares_map, use_provider, with_key):
    map_id = squares_map(nodata_left=1500)
    est = client.post(f"{BASE}/{project_id}/map-runs/estimate", json=run_body(map_id)).json()
    assert est["skipped_windows"] >= 2 and est["requests"] == est["windows"] - est["skipped_windows"]
    assert est["estimated_cost"] == pytest.approx(0.02 * est["requests"])
    provider = use_provider(SquareProvider())
    start(client, project_id, wait_job, run_body(map_id))
    assert len(provider.calls) == est["requests"]


def test_a_machine_at_the_edge_of_coverage_is_still_counted(
    client, project_id, wait_job, tmp_path, use_provider, with_key
):
    """A square mostly inside a skipped (nodata) window must still be found once, from the sliver
    visible in the neighbouring window that did run. Windows for this 3000 x 1500 map at the
    default tile_size/overlap are columns at x=0, 1024, 1720 (see test_maps_windows.py); with
    nodata_left=1280 the x=0 column is 100 % nodata (skipped) and the x=1024 column is only 20 %
    nodata (runs). A square at x=1000..1060 sits almost entirely in the skipped column; only its
    x=1024..1060 sliver (36 px) is visible to the x=1024 window. The old "neighbour holds the rest"
    assumption would drop that sliver as a cut box and the square would never be counted at all.
    """
    path = make_squares_geotiff(tmp_path / "edge.tif", 3000, 1500, [(1000, 200, 60)], nodata_left=1280)
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    map_id = r.json()["map"]["id"]
    use_provider(SquareProvider())
    run_id, job = start(client, project_id, wait_job, run_body(map_id))
    assert job["state"] == "succeeded", job
    assert job["result"]["skipped_windows"] >= 1
    assert client.get(f"{BASE}/{project_id}/map-runs/{run_id}").json()["detection_count"] == 1


def test_gsd_scaling_keeps_boxes_in_map_pixels(
    client, project_id, wait_job, squares_map, use_provider, with_key
):
    map_id = squares_map()  # 3 cm per pixel
    use_provider(SquareProvider())
    est = client.post(
        f"{BASE}/{project_id}/map-runs/estimate", json=run_body(map_id, target_gsd_cm=6.0)
    ).json()
    assert est["scale"] == pytest.approx(0.5)
    run_id, _ = start(client, project_id, wait_job, run_body(map_id, target_gsd_cm=6.0))
    boxes = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/detections").json()["items"]
    assert len(boxes) == 4 and all(b["w"] == pytest.approx(60, abs=6) for b in boxes)


def test_resume_only_repeats_failed_windows(
    client, project_id, wait_job, squares_map, use_provider, with_key
):
    map_id = squares_map()
    use_provider(SquareProvider(fail_windows={1}))
    run_id, job = start(client, project_id, wait_job, run_body(map_id))
    assert job["state"] == "succeeded" and job["result"]["failed_windows"] == 1
    second = use_provider(SquareProvider())
    r = client.post(f"{BASE}/{project_id}/map-runs/{run_id}/resume")
    assert r.status_code == 202
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    assert second.calls == [1]
    assert client.get(f"{BASE}/{project_id}/map-runs/{run_id}").json()["detection_count"] == 4


def test_bbox_query_and_truncation(
    client, project_id, wait_job, squares_map, use_provider, with_key, monkeypatch
):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    url = f"{BASE}/{project_id}/map-runs/{run_id}/detections"
    assert len(client.get(url, params={"bbox": "0,0,1000,1000"}).json()["items"]) == 1
    assert client.get(url, params={"min_conf": 0.95}).json()["items"] == []
    assert client.get(url, params={"bbox": "a,b,c,d"}).status_code == 422
    # Four comma-separated groups, digits and dots only, but not four real floats: a filter the
    # caller cannot have meant is a 422, never a silent "no filter" that returns the whole map.
    assert client.get(url, params={"bbox": "1.2.3,4,5,6"}).status_code == 422
    monkeypatch.setattr("app.maps.service.MAX_DETECTIONS", 2)
    page = client.get(url).json()
    assert len(page["items"]) == 2 and page["truncated"] is True


def test_density_grid(client, project_id, wait_job, squares_map, use_provider, with_key, class_ids):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    d = client.get(f"{BASE}/{project_id}/map-runs/{run_id}/density", params={"cells": 10}).json()
    assert d["cell_size"] == pytest.approx(300)
    assert sum(c["count"] for c in d["cells"]) == 4
    assert {(c["gx"], c["gy"]) for c in d["cells"]} == {(0, 0), (4, 1), (8, 3), (8, 1)}


def test_runs_list_and_delete(client, project_id, wait_job, squares_map, use_provider, with_key, handle):
    map_id = squares_map()
    use_provider(SquareProvider())
    run_id, _ = start(client, project_id, wait_job, run_body(map_id))
    items = client.get(f"{BASE}/{project_id}/maps/{map_id}/runs").json()["items"]
    assert [i["id"] for i in items] == [run_id]
    assert client.delete(f"{BASE}/{project_id}/map-runs/{run_id}").status_code == 204
    with handle.session() as s:
        assert s.query(MapDetection).count() == 0


def test_run_on_a_map_that_is_not_ready_is_409(client, project_id, handle, with_key):
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="m", status="importing", source_path="x", source_size=1)
        s.add(row)
        s.flush()
        map_id = row.id
    assert client.post(f"{BASE}/{project_id}/map-runs", json=run_body(map_id)).status_code == 409


@pytest.fixture
def class_ids(project) -> dict:
    return {c["name"]: c["id"] for c in project["classes"]}
