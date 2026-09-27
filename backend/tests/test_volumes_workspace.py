"""Volumes in the map workspace (map spec §10): material, polygon_site, toe_lowest through the API."""

import pytest
from pyproj import CRS, Transformer
from surfaces import CX, CY, WKT, circle, cone, fixture_spec, plane
from volume_rows import add_surface
from workspace_rows import set_site_frame

BASE = "/api/v1/projects"


@pytest.fixture
def top(handle):
    return add_surface(handle, fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y), name="April")


@pytest.fixture
def measure(client, wait_job, project_id):
    def _measure(top_id, *, base=None, **extra):
        body = {
            "name": extra.pop("name", "Pile 1"),
            "top_surface_id": top_id,
            "base": base or {"kind": "toe_plane"},
            **extra,
        }
        if "polygon_site" not in body:
            body.setdefault("polygon_native", circle(CX, CY, 12.0, 128))
        r = client.post(f"{BASE}/{project_id}/volumes", json=body)
        assert r.status_code == 202, r.text
        job = wait_job(project_id, r.json()["job"]["id"])
        got = client.get(f"{BASE}/{project_id}/volumes/{r.json()['measurement']['id']}").json()
        return got, job

    return _measure


def test_material_is_stored_and_never_makes_a_result_stale(client, project_id, top, measure):
    m, job = measure(top, material={"name": "Gravel", "density_t_m3": 1.6})
    assert job["state"] == "succeeded", job
    assert m["material"] == {"name": "Gravel", "density_t_m3": 1.6} and m["status"] == "ready"
    url = f"{BASE}/{project_id}/volumes/{m['id']}"
    got = client.patch(url, json={"material": {"name": "Sand", "density_t_m3": 1.5}}).json()
    assert got["status"] == "ready" and got["stale_reasons"] == [] and got["material"]["name"] == "Sand"
    cleared = client.patch(url, json={"material": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["material"] is None and cleared.json()["status"] == "ready"
    assert client.patch(url, json={"name": None}).status_code == 422  # other nulls stay refused


def test_a_measurement_without_material_says_null(top, measure):
    m, _ = measure(top)
    assert m["material"] is None


def test_toe_lowest_through_the_api(top, measure):
    m, job = measure(top, base={"kind": "toe_lowest"})
    assert job["state"] == "succeeded", job
    assert m["base"] == {"kind": "toe_lowest", "z": None, "surface_id": None}
    assert m["results"]["base_fit"]["kind"] == "toe_lowest"


UTM38 = CRS.from_epsg(32638).to_wkt()  # the neighbouring zone of the fixtures' UTM 39


def _to_site(ring, site_wkt):
    t = Transformer.from_crs(CRS.from_wkt(WKT), CRS.from_wkt(site_wkt), always_xy=True)
    return [list(t.transform(x, y)) for x, y in ring]


def test_polygon_site_is_stored_in_the_top_surface_crs(handle, top, measure):
    set_site_frame(handle, UTM38)
    ring = circle(CX, CY, 12.0, 128)
    m, job = measure(top, polygon_site=_to_site(ring, UTM38))
    assert job["state"] == "succeeded", job
    for got, want in zip(m["polygon_native"], ring, strict=True):
        assert got == pytest.approx(want, abs=1e-4)
    assert m["results"]["fill_m3"] == pytest.approx(3.14159 * 100 * 5 / 3, rel=0.001)


def test_polygon_site_in_the_same_crs_is_unchanged(handle, top, measure):
    set_site_frame(handle, WKT)
    ring = circle(CX, CY, 12.0, 128)
    m, _ = measure(top, polygon_site=ring)
    assert m["polygon_native"] == [pytest.approx(p, abs=1e-6) for p in ring]


def test_patch_takes_polygon_site_too(client, project_id, handle, top, measure):
    set_site_frame(handle, UTM38)
    m, _ = measure(top)
    moved = circle(CX + 1.0, CY, 12.0, 128)
    r = client.patch(f"{BASE}/{project_id}/volumes/{m['id']}", json={"polygon_site": _to_site(moved, UTM38)})
    assert r.status_code == 200, r.text
    assert r.json()["polygon_native"][0] == pytest.approx(moved[0], abs=1e-4)
    assert r.json()["status"] == "stale" and "polygon changed" in r.json()["stale_reasons"]


@pytest.mark.parametrize("frame", ["none", "local"])
def test_polygon_site_without_a_usable_site_frame_is_invalid_geometry(client, project_id, handle, top, frame):
    if frame == "local":
        set_site_frame(handle, None)
    body = {
        "name": "P",
        "polygon_site": circle(CX, CY, 12.0),
        "top_surface_id": top,
        "base": {"kind": "toe_plane"},
    }
    r = client.post(f"{BASE}/{project_id}/volumes", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_geometry", r.text


def test_both_or_neither_polygon_is_invalid_geometry(client, project_id, handle, top):
    set_site_frame(handle, WKT)
    ring = circle(CX, CY, 12.0)
    base = {"name": "P", "top_surface_id": top, "base": {"kind": "toe_plane"}}
    for extra in ({"polygon_native": ring, "polygon_site": ring}, {}):
        r = client.post(f"{BASE}/{project_id}/volumes", json={**base, **extra})
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] in ("invalid_geometry", "validation_error")
