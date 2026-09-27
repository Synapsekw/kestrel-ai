"""`/map-measurements` over HTTP (plan maps-b4 Task 5; spec §12): status codes, the event and
`?frame=site`."""

import pytest
from mapmeasure_rows import set_site_frame
from surfaces import EPSG, X0, Y1, fixture_spec, plane
from volume_rows import add_surface

BASE = "/api/v1/projects"
LINE = [[X0 + 5, Y1 - 5], [X0 + 45, Y1 - 5]]


def url(pid: str, mid: str | None = None) -> str:
    return f"{BASE}/{pid}/map-measurements" + (f"/{mid}" if mid else "")


@pytest.fixture
def dsm(handle) -> str:
    set_site_frame(handle, EPSG)
    return add_surface(handle, fixture_spec(0.1), plane, name="DSM")


@pytest.fixture
def events(app, monkeypatch) -> list[dict]:
    seen: list[dict] = []
    monkeypatch.setattr(app.state.events, "publish", seen.append)
    return seen


def _changed(events) -> list[dict]:
    return [e["payload"] for e in events if e["type"] == "map_measurements.changed"]


def test_crud_round_trip_publishes_map_measurements_changed(client, project_id, dsm, events):
    r = client.post(url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": [dsm]})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert r.json()["results"]["series"][0]["surface_id"] == dsm
    assert client.get(url(project_id, mid), params={"frame": "site"}).json()["vertices"] == LINE
    patched = client.patch(url(project_id, mid), json={"note": "north ramp"})
    assert patched.status_code == 200 and patched.json()["note"] == "north ramp"
    page = client.get(url(project_id), params={"frame": "site"}).json()
    assert [i["id"] for i in page["items"]] == [mid] and page["items"][0]["results"]["series"] == []
    assert page["next_cursor"] is None
    assert client.delete(url(project_id, mid)).status_code == 204
    assert client.get(url(project_id, mid)).status_code == 404
    assert _changed(events) == [{"measurement_ids": [mid]}] * 3


def test_refusals_answer_their_own_codes(client, project_id, dsm, events):
    far = [[X0 + 200, Y1 - 5], [X0 + 240, Y1 - 5]]
    r = client.post(url(project_id), json={"kind": "profile", "vertices": far, "surface_ids": [dsm]})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "no_surface_under_line")
    nan_body = '{"kind": "distance", "vertices": [[1, 2], [NaN, 2]]}'
    r = client.post(url(project_id), content=nan_body, headers={"content-type": "application/json"})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")
    missing = client.post(
        url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": ["nope"]}
    )
    assert missing.status_code == 404
    assert _changed(events) == []


def test_no_site_frame_is_409(client, project_id):
    r = client.post(url(project_id), json={"kind": "distance", "vertices": LINE})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "no_site_frame")
    assert client.get(url(project_id), params={"frame": "site"}).status_code == 409
    assert client.get(url(project_id)).json() == {"items": [], "next_cursor": None}


def test_an_unknown_project_is_404(client):
    assert client.get(url("nope")).status_code == 404


def test_list_kind_filter(client, project_id, dsm):
    r = client.post(url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": [dsm]})
    assert r.status_code == 201, r.text
    profile_id = r.json()["id"]
    dist = client.post(url(project_id), json={"kind": "distance", "vertices": LINE})
    assert dist.status_code == 201, dist.text

    profiles = client.get(url(project_id), params={"kind": "profile"}).json()
    assert [i["id"] for i in profiles["items"]] == [profile_id]

    distances = client.get(url(project_id), params={"kind": "distance"}).json()
    assert [i["id"] for i in distances["items"]] == [dist.json()["id"]]

    areas = client.get(url(project_id), params={"kind": "area"}).json()
    assert areas["items"] == []
