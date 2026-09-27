"""A dem surface in the Data list and as a volume top and base (spec §4 item 7, §7 last paragraph)."""

import math

import pytest
from design_targets import write_target
from surfaces import CX, CY, circle, cone, fixture_spec, plane
from test_elevation_import import import_file
from test_surfaces_dates import validate

BASE = "/api/v1/projects"
CONE = math.pi * 100 * 5 / 3


def test_the_data_list_dates_a_dem_by_its_own_column(client, wait_job, project_id, tmp_path):
    src = write_target(tmp_path / "dsm.tif", fixture_spec(0.5), plane)
    _, _, s = import_file(
        client, wait_job, project_id, path=str(src), role="dsm", captured_on="2026-08-14", name="Aug DSM"
    )
    items = client.get(f"{BASE}/{project_id}/data", params={"type": ["elevation"]}).json()["items"]
    assert [(i["id"], i["captured_on"], i["summary"]["kind"]) for i in items] == [
        (s["id"], "2026-08-14", "dem")
    ]
    validate("DataItem", items[0])


def test_a_dem_is_a_volume_top_and_base(client, wait_job, project_id, tmp_path):
    aug = write_target(tmp_path / "aug.tif", fixture_spec(0.1), plane)
    sep = write_target(tmp_path / "sep.tif", fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y))
    _, _, base = import_file(
        client, wait_job, project_id, path=str(aug), role="dsm", captured_on="2026-08-14", name="Aug DSM"
    )
    _, _, top = import_file(
        client, wait_job, project_id, path=str(sep), role="dsm", captured_on="2026-09-14", name="Sep DSM"
    )
    body = {
        "name": "Pile",
        "polygon_native": circle(CX, CY, 12.0, 128),
        "top_surface_id": top["id"],
        "base": {"kind": "surface", "surface_id": base["id"]},
    }
    r = client.post(f"{BASE}/{project_id}/volumes", json=body)
    assert r.status_code == 202, r.text
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    m = client.get(f"{BASE}/{project_id}/volumes/{r.json()['measurement']['id']}").json()
    res = m["results"]
    assert res["fill_m3"] == pytest.approx(CONE, rel=0.01) and res["net_m3"] == pytest.approx(CONE, rel=0.01)
    assert (res["top_surface"]["kind"], res["top_surface"]["captured_on"]) == ("dem", "2026-09-14")
    assert (res["base_surface"]["kind"], res["base_surface"]["captured_on"]) == ("dem", "2026-08-14")
    validate("VolumeMeasurement", m)
    r = client.post(f"{BASE}/{project_id}/volumes", json={**body, "base": {"kind": "toe_plane"}})
    assert r.status_code == 202, r.text
