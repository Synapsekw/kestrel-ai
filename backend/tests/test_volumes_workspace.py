"""Volumes in the map workspace (map spec §10): material, polygon_site, toe_lowest through the API."""

import pytest
from surfaces import CX, CY, circle, cone, fixture_spec, plane
from volume_rows import add_surface

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
