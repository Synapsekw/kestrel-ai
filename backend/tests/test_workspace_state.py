"""The workspace state and the site frame choice (spec 2026-09-26-map-workspace section 6, M3)."""

import threading
from datetime import timedelta

import pytest
from pyproj import CRS
from sqlalchemy import func, select
from surfaces import fixture_spec, plane
from volume_rows import add_surface
from workspace_rows import BASE, add_local_surface, add_map

from app.db.models import GeoMap, MapWorkspace, Surface
from app.errors import AppError
from app.workspace import service
from app.workspace.frame import LOCAL, SiteFrame

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
WGS84 = CRS.from_epsg(4326).to_wkt()
GT38 = [780000.0, 0.05, 0.0, 3266000.0, 0.0, -0.05]


def _rows(handle) -> int:
    with handle.session() as s:
        return s.execute(select(func.count()).select_from(MapWorkspace)).scalar_one()


def test_empty_project_then_first_ortho_decides(handle):
    """Review Focus 2: the first read persists a local frame; the first ortho replaces it."""
    ws = service.load(handle)
    assert ws.frame == LOCAL and ws.updated_at is not None and _rows(handle) == 1
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    assert service.load(handle).frame == SiteFrame("crs", UTM38, 32638)
    assert _rows(handle) == 1


def test_the_first_georeferenced_item_wins(handle):
    surface_id = add_surface(handle, fixture_spec(0.5), plane)  # EPSG:32639, created first
    map_id = add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    with handle.session() as s:
        # F11: an explicit, later created_at on the map row so the test does not depend on clock
        # resolution (Windows ties at 15.6 ms; on a tie the map would sort first).
        surface_created_at = s.get(Surface, surface_id).created_at
        s.get(GeoMap, map_id).created_at = surface_created_at + timedelta(seconds=1)
    assert service.get_frame(handle).epsg == 32639


def test_the_oldest_item_decides_even_when_listed_later(handle):
    new = add_map(
        handle, crs_wkt=UTM39, geotransform=[500000.0, 0.05, 0, 3300000.0, 0, -0.05], width=400, height=400
    )
    old = add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    with handle.session() as s:
        s.get(GeoMap, old).created_at = s.get(GeoMap, new).created_at - timedelta(days=3)
    assert service.get_frame(handle).epsg == 32638


def test_a_geographic_first_map_gives_the_utm_zone_of_its_centre(handle):
    add_map(handle, crs_wkt=WGS84, geotransform=[48.01, 1e-6, 0, 29.5, 0, -1e-6], width=400, height=400)
    assert service.get_frame(handle).epsg == 32639


def test_only_local_items_give_a_local_frame_that_stays(handle):
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    assert service.get_frame(handle) == LOCAL
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    assert service.get_frame(handle) == LOCAL  # a local frame with local items is kept


def test_a_local_frame_whose_local_items_are_gone_rederives(handle):
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    assert service.get_frame(handle) == LOCAL
    with handle.session() as s:
        for row in s.execute(select(Surface)).scalars():
            s.delete(row)
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    assert service.get_frame(handle).epsg == 32638


def test_maps_that_are_not_ready_or_have_no_crs_do_not_decide(handle):
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400, status="importing")
    add_map(handle, crs_wkt=None, geotransform=None, width=400, height=400)
    assert service.load(handle).frame == LOCAL


def test_frame_items_counts_both_frames(handle):
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    add_local_surface(handle, fixture_spec(0.25, crs_wkt=None, epsg=None), plane)
    with handle.session() as s:
        assert service.frame_items(s) == {"crs": 1, "local": 2}


def test_set_frame_and_put_state(handle):
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    assert service.set_frame(handle, kind="crs", epsg=32639).frame.epsg == 32639
    ws = service.put_state(
        handle, state={"mode": "swipe"}, planned_surveys=[{"date": "2026-10-14", "note": "Oct"}]
    )
    assert ws.state == {"mode": "swipe"} and ws.planned_surveys == [{"date": "2026-10-14", "note": "Oct"}]
    ws = service.put_state(handle, state={"mode": "blend"}, planned_surveys=None)  # planned kept
    assert ws.planned_surveys == [{"date": "2026-10-14", "note": "Oct"}] and ws.frame.epsg == 32639


def test_set_frame_crs_without_epsg_picks_the_m3_frame(handle):
    """The frame switch back from local metres (M-W2 Task 11a): the server's own rule M3."""
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    assert service.get_frame(handle) == LOCAL  # the row is created local, and stays local
    add_map(handle, crs_wkt=WGS84, geotransform=[48.01, 1e-6, 0, 29.5, 0, -1e-6], width=400, height=400)
    assert service.get_frame(handle) == LOCAL
    assert service.set_frame(handle, kind="crs", epsg=None).frame.epsg == 32639
    assert service.get_frame(handle).epsg == 32639


def test_set_frame_crs_without_epsg_and_nothing_georeferenced_is_refused(handle):
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    with pytest.raises(AppError) as e:
        service.set_frame(handle, kind="crs", epsg=None)
    assert (e.value.status, e.value.code) == (422, "invalid_epsg")
    assert service.get_frame(handle) == LOCAL


def test_state_over_64_kb_is_refused_and_unchanged(handle):
    service.put_state(handle, state={"a": 1}, planned_surveys=None)
    with pytest.raises(AppError) as e:
        service.put_state(handle, state={"blob": "x" * service.MAX_STATE_BYTES}, planned_surveys=None)
    assert (e.value.status, e.value.code) == (422, "state_too_large")
    assert service.load(handle).state == {"a": 1}


def test_state_saved_on_an_empty_project_survives_the_first_ortho(handle):
    service.put_state(handle, state={"mode": "single"}, planned_surveys=None)
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    ws = service.load(handle)
    assert ws.frame.epsg == 32638 and ws.state == {"mode": "single"}


def test_concurrent_first_loads_create_one_row(handle):
    """Review Focus 5."""
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    errors: list[BaseException] = []

    def work():
        try:
            service.load(handle)
        except BaseException as e:  # collected and asserted below
            errors.append(e)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [] and _rows(handle) == 1


def test_get_map_workspace_on_an_empty_project(client, project_id):
    r = client.get(f"{BASE}/{project_id}/map-workspace")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["frame"] == {
        "kind": "local",
        "epsg": None,
        "crs_wkt": None,
        "proj4": None,
        "name": "Local metres",
    }
    assert body["state"] == {} and body["planned_surveys"] == [] and body["updated_at"]
    assert body["frame_items"] == {"crs": 0, "local": 0}


def test_set_frame_publishes_and_get_reflects_it(client, project_id, handle, monkeypatch):
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    seen = []
    monkeypatch.setattr(client.app.state.events, "publish", seen.append)
    r = client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "crs", "epsg": 32639})
    assert r.status_code == 200, r.text
    assert r.json()["frame"]["epsg"] == 32639 and "+zone=39" in r.json()["frame"]["proj4"]
    events = [e for e in seen if e["type"] == "map_workspace.changed"]
    assert events and events[-1]["payload"] == {"fields": ["frame"]}
    assert client.get(f"{BASE}/{project_id}/map-workspace").json()["frame"]["epsg"] == 32639
    assert (
        client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "local"}).json()["frame"]["kind"]
        == "local"
    )


def test_set_frame_error_codes(client, project_id):
    url = f"{BASE}/{project_id}/map-workspace/frame"
    for body, code in (
        ({"kind": "crs", "epsg": 4326}, "needs_projected_crs"),
        ({"kind": "crs", "epsg": 999999}, "invalid_epsg"),
        ({"kind": "crs"}, "invalid_epsg"),  # nothing has coordinates yet
    ):
        r = client.put(url, json=body)
        assert (r.status_code, r.json()["error"]["code"]) == (422, code), body


def test_put_map_workspace_round_trips_publishes_and_refuses_big_state(
    client, project_id, handle, monkeypatch
):
    add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    seen = []
    monkeypatch.setattr(client.app.state.events, "publish", seen.append)
    body = {
        "state": {"mode": "blend", "blend": 40},
        "planned_surveys": [{"date": "2026-10-14", "note": None}],
    }
    r = client.put(f"{BASE}/{project_id}/map-workspace", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["state"] == body["state"] and r.json()["planned_surveys"] == body["planned_surveys"]
    events = [e for e in seen if e["type"] == "map_workspace.changed"]
    assert events and events[-1]["payload"] == {"fields": ["state", "planned_surveys"]}
    r = client.put(f"{BASE}/{project_id}/map-workspace", json={"state": {"x": "y" * 70_000}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "state_too_large"
