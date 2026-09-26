"""Measurement CRUD (spec §4.1 ops 8-11, §9): server-computed results, refusals, the cap, events."""

import pytest
from pointclouds import insert_cloud
from pyproj import CRS, Transformer

from app.db.models import CloudMeasurement

BASE = "/api/v1/projects"
P = lambda x, y, z, u=0.01: {"x": x, "y": y, "z": z, "uncertainty_m": u}  # noqa: E731


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def murl(project_id, cloud_id, mid=""):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/measurements" + (f"/{mid}" if mid else "")


def test_create_list_rename_delete(client, project_id, cloud_id):
    body = {"kind": "distance", "points": [P(243500, 3178000, 0), P(243503, 3178004, 12)]}
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["name"] == "Distance 1" and m["results"]["distance_3d"] == pytest.approx(13.0)
    assert m["results"]["lean_angle_deg"] is None
    second = client.post(murl(project_id, cloud_id), json=body).json()
    assert second["name"] == "Distance 2"
    r = client.patch(
        murl(project_id, cloud_id, m["id"]), json={"name": "Stack to gate", "note": "north face"}
    )
    assert r.status_code == 200 and (r.json()["name"], r.json()["note"]) == ("Stack to gate", "north face")
    items = client.get(murl(project_id, cloud_id)).json()["items"]
    assert [i["name"] for i in items] == ["Stack to gate", "Distance 2"]
    assert client.delete(murl(project_id, cloud_id, m["id"])).status_code == 204
    assert client.delete(murl(project_id, cloud_id, m["id"])).status_code == 404


def test_the_server_recomputes_and_ignores_client_results(client, project_id, cloud_id):
    body = {
        "kind": "height",
        "points": [P(10, 10, 50), P(10, 12, 47.5)],
        "results": {"height_difference": 999},
    }
    m = client.post(murl(project_id, cloud_id), json=body).json()
    assert m["results"]["height_difference"] == pytest.approx(-2.5)


def test_point_gets_wgs84_from_pyproj(client, project_id, cloud_id):
    m = client.post(
        murl(project_id, cloud_id), json={"kind": "point", "points": [P(243522.123, 3178252.456, -44.3)]}
    ).json()
    lon, lat = Transformer.from_crs(32639, 4326, always_xy=True).transform(243522.123, 3178252.456)
    assert m["results"]["lon"] == pytest.approx(lon, abs=1e-7) and m["results"]["lat"] == pytest.approx(
        lat, abs=1e-7
    )
    assert m["name"] == "Point 1"


def test_vertical_is_stored_lower_first(client, project_id, cloud_id):
    m = client.post(
        murl(project_id, cloud_id), json={"kind": "vertical", "points": [P(1, 1, 60), P(1, 1.1, 0)]}
    ).json()
    assert [p["z"] for p in m["points"]] == [0, 60] and m["name"] == "Vertical check 1"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"kind": "point", "points": [P(0, 0, 0), P(1, 1, 1)]}, "wrong_point_count"),
        ({"kind": "distance", "points": [P(0, 0, 0)]}, "wrong_point_count"),
        ({"kind": "vertical", "points": [P(0, 0, 0), P(0.2, 0, 0.49)]}, "vertical_span_too_small"),
    ],
)
def test_refusals(client, project_id, cloud_id, body, code):
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_vertical_refusal_names_the_fix(client, project_id, cloud_id):
    r = client.post(
        murl(project_id, cloud_id), json={"kind": "vertical", "points": [P(0, 0, 0), P(0, 0, 0.3)]}
    )
    assert r.json()["error"]["message"] == "pick points further apart vertically (at least 0.5 m)"


def test_geographic_clouds_refuse_distances(client, project_id, handle):
    """Review Focus 4."""
    wgs = CRS.from_epsg(4326)
    geo = insert_cloud(handle, crs_wkt=wgs.to_wkt(), epsg=4326, proj4=wgs.to_proj4())
    r = client.post(
        murl(project_id, geo), json={"kind": "distance", "points": [P(48.1, 28.1, 0), P(48.2, 28.2, 5)]}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "needs_projected_crs"
    assert (
        r.json()["error"]["message"]
        == "distances need a projected coordinate system; this cloud is in degrees"
    )
    assert (
        client.post(murl(project_id, geo), json={"kind": "point", "points": [P(48.1, 28.1, 0)]}).status_code
        == 201
    )


def test_no_crs_point_has_no_wgs84(client, project_id, handle):
    bare = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None, crs_source=None, bounds_wgs84=None)
    m = client.post(murl(project_id, bare), json={"kind": "point", "points": [P(1, 2, 3)]}).json()
    assert m["results"]["lon"] is None and m["results"]["uncertainty_m"] == pytest.approx(0.01)


def test_the_1000_cap(client, project_id, handle, cloud_id):
    with handle.session() as s:
        for i in range(1000):
            s.add(
                CloudMeasurement(
                    point_cloud_id=cloud_id,
                    kind="point",
                    name=f"Point {i + 1}",
                    note=None,
                    points=[P(0, 0, 0)],
                    results={},
                )
            )
    r = client.post(murl(project_id, cloud_id), json={"kind": "point", "points": [P(0, 0, 0)]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "measurement_limit"


def test_unknown_cloud_404_and_not_ready_409(client, project_id, handle):
    body = {"kind": "point", "points": [P(0, 0, 0)]}
    assert client.post(murl(project_id, "nope"), json=body).status_code == 404
    importing = insert_cloud(handle, status="importing")
    assert client.post(murl(project_id, importing), json=body).status_code == 409


def test_changes_publish_pointclouds_changed(client, project_id, cloud_id, app):
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    client.post(murl(project_id, cloud_id), json={"kind": "point", "points": [P(0, 0, 0)]})
    assert any(e["type"] == "pointclouds.changed" and e["payload"] == {"cloud_ids": [cloud_id]} for e in seen)
