"""Anchor, sample and findings in view (spec 2026-09-26-map-workspace sections 9.4 and 12)."""

import pytest
from pyproj import CRS, Transformer
from surfaces import CX, CY, X0, fixture_spec, plane
from volume_rows import add_surface
from workspace_rows import BASE, add_local_surface, add_map, set_frame

from app.workspace import views

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.1, 0.0, 3300000.0, 0.0, -0.1]
O38 = Transformer.from_crs("EPSG:4326", "EPSG:32638", always_xy=True).transform(47.99, 29.5)
GT38 = [round(O38[0], 1), 0.1, 0.0, round(O38[1], 1), 0.0, -0.1]
T38_39 = Transformer.from_crs("EPSG:32638", "EPSG:32639", always_xy=True)


def _anchor(client, project_id, map_id, geometry):
    return client.post(
        f"{BASE}/{project_id}/map-workspace/anchor", json={"map_id": map_id, "geometry_site": geometry}
    )


def _error(r):
    return r.status_code, r.json()["error"]["code"]


def test_anchor_in_the_same_crs_is_identity_with_lon_lat(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    set_frame(client, project_id, 32639)
    r = _anchor(client, project_id, m, {"type": "Point", "coordinates": [500010.0, 3299990.0]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["geometry"] == {"type": "Point", "coordinates": [500010.0, 3299990.0]}
    lon, lat = Transformer.from_crs("EPSG:32639", "EPSG:4326", always_xy=True).transform(500010.0, 3299990.0)
    assert (body["lon"], body["lat"]) == pytest.approx((lon, lat), abs=1e-9)


def test_anchor_across_crss_and_polygons_stay_closed(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    set_frame(client, project_id, 32639)
    cx, cy = T38_39.transform(GT38[0] + 20, GT38[3] - 20)
    ring = [[cx, cy], [cx + 2, cy], [cx + 2, cy - 2], [cx, cy - 2], [cx, cy]]
    r = _anchor(client, project_id, m, {"type": "Polygon", "coordinates": [ring]})
    assert r.status_code == 200, r.text
    native = r.json()["geometry"]["coordinates"][0]
    assert native[0] == native[-1]
    assert native[0] == pytest.approx([GT38[0] + 20, GT38[3] - 20], abs=1e-6)


def test_anchor_refusals(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    bare = add_map(handle, crs_wkt=None, geotransform=None, width=400, height=400)
    set_frame(client, project_id, 32639)
    outside = _anchor(client, project_id, m, {"type": "Point", "coordinates": [500100.0, 3299990.0]})
    assert _error(outside) == (422, "outside_map")
    assert outside.json()["error"]["message"] == "Findings need an orthomosaic under them."
    assert _anchor(client, project_id, "nope", {"type": "Point", "coordinates": [0, 0]}).status_code == 404
    assert _error(_anchor(client, project_id, bare, {"type": "Point", "coordinates": [0, 0]})) == (
        422,
        "no_coordinates",
    )
    open_ring = {
        "type": "Polygon",
        "coordinates": [[[500001, 3299999], [500002, 3299999], [500002, 3299998]]],
    }
    assert _error(_anchor(client, project_id, m, open_ring)) == (422, "invalid_geometry")
    big = [[500000.0 + i * 1e-3, 3299990.0] for i in range(5001)] + [[500000.0, 3299990.0]]
    assert _error(_anchor(client, project_id, m, {"type": "Polygon", "coordinates": [big]})) == (
        422,
        "invalid_geometry",
    )
    # a local item keeps the frame local on the next read (service.py's `_stale_local`, plan
    # deviation 9); without one a local frame next to a georeferenced map would re-derive to its CRS.
    add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "local"})
    local = _anchor(client, project_id, m, {"type": "Point", "coordinates": [500010.0, 3299990.0]})
    assert _error(local) == (422, "local_frame")


def test_sample_returns_z_per_surface_and_null_for_the_rest(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.1), plane)
    set_frame(client, project_id, 32639)
    url = f"{BASE}/{project_id}/map-workspace/sample"
    r = client.post(url, json={"x": CX, "y": CY, "surface_ids": [sid, "nope"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["x"], body["y"]) == (CX, CY)
    z = {i["surface_id"]: i["z"] for i in body["samples"]}
    assert z[sid] == pytest.approx(float(plane(CX, CY)), abs=1e-3) and z["nope"] is None
    assert (
        client.post(url, json={"x": X0 - 500, "y": CY, "surface_ids": [sid]}).json()["samples"][0]["z"]
        is None
    )
    assert (
        client.post(url, json={"x": 0, "y": 0, "surface_ids": [f"s{i}" for i in range(9)]}).status_code == 422
    )


def test_sample_rejects_duplicate_surface_ids(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.1), plane)
    set_frame(client, project_id, 32639)
    url = f"{BASE}/{project_id}/map-workspace/sample"
    r = client.post(url, json={"x": CX, "y": CY, "surface_ids": [sid, sid]})
    assert _error(r) == (422, "validation_error")


def _finding(client, project_id, map_id, type_id, site_xy, severity=2):
    anchor = _anchor(client, project_id, map_id, {"type": "Point", "coordinates": list(site_xy)}).json()
    r = client.post(
        f"{BASE}/{project_id}/findings",
        json={
            "type_id": type_id,
            "anchor": {"kind": "map", "map_id": map_id, "geometry": anchor["geometry"]},
            "lon": anchor["lon"],
            "lat": anchor["lat"],
            "severity": severity,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_findings_in_view(client, project_id, handle, crack):
    m = add_map(handle, crs_wkt=UTM38, geotransform=GT38, width=400, height=400)
    set_frame(client, project_id, 32639)
    site = T38_39.transform(GT38[0] + 10, GT38[3] - 10)
    f = _finding(client, project_id, m, crack["id"], site)
    url = f"{BASE}/{project_id}/map-workspace/findings"
    bbox = f"{site[0] - 5},{site[1] - 5},{site[0] + 5},{site[1] + 5}"
    r = client.get(url, params={"bbox": bbox, "frame": "site"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["truncated"] is False and [i["id"] for i in body["items"]] == [f["id"]]
    item = body["items"][0]
    assert item["geometry_site"]["coordinates"] == pytest.approx(list(site), abs=1e-6)
    assert (item["number"], item["type_id"], item["severity"], item["map_id"]) == (
        f["number"],
        crack["id"],
        2,
        m,
    )
    far = f"{site[0] + 100},{site[1] + 100},{site[0] + 200},{site[1] + 200}"
    assert client.get(url, params={"bbox": far}).json()["items"] == []
    assert client.get(url, params={"bbox": bbox, "map_ids": ["someone-else"]}).json()["items"] == []
    assert len(client.get(url, params={"bbox": bbox, "map_ids": [m, "x"]}).json()["items"]) == 1


def test_findings_in_view_truncate_least_severe_first(client, project_id, handle, crack, monkeypatch):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    set_frame(client, project_id, 32639)
    ids = [
        _finding(client, project_id, m, crack["id"], (500010.0 + i, 3299990.0), severity=s)["id"]
        for i, s in enumerate((1, 2, 4))
    ]
    monkeypatch.setattr(views, "MAX_FINDINGS", 2)
    body = client.get(
        f"{BASE}/{project_id}/map-workspace/findings", params={"bbox": "500000,3299960,500040,3300000"}
    ).json()
    assert body["truncated"] is True and [i["id"] for i in body["items"]] == [ids[2], ids[1]]


def test_findings_in_a_local_frame_are_empty(client, project_id):
    client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "local"})
    body = client.get(f"{BASE}/{project_id}/map-workspace/findings", params={"bbox": "0,0,1,1"}).json()
    assert body == {"items": [], "truncated": False}
