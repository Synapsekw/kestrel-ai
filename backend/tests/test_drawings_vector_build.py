"""Building vector drawings (spec §8.2 build DXF/LandXML, placement `crs`; plan Task 12)."""

import pytest
from design_dxf import new_doc, save
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_landxml

from app.drawings import runs, store


def _site_dxf(tmp_path, insunits=6, scale=1.0):
    doc = new_doc(insunits=insunits)
    msp = doc.modelspace()
    for i in range(5):
        msp.add_line((scale * i * 10, 0), (scale * i * 10, scale * 30), dxfattribs={"layer": "WALLS"})
    msp.add_line((0, 0), (scale * 40, 0), dxfattribs={"layer": "ROADS"})
    msp.add_text("GATE", height=2 * scale, dxfattribs={"layer": "TEXT"}).set_placement((scale * 5, scale * 5))
    return save(doc, tmp_path / "site.dxf")


def test_a_layer_subset_builds_an_index(client, project_id, wait_job, handle, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, _site_dxf(tmp_path))
    d = build_drawing(client, project_id, wait_job, insp["id"], layers=["WALLS", "TEXT"])
    assert [la["name"] for la in d["layers"]] == ["WALLS", "TEXT"]
    assert d["layer_state"] == {"hidden_layers": [], "knockout_white": False} and d["units"] == "metre"
    assert d["kind"] == "vector"
    folder = store.drawing_dir(handle, d["id"])
    rs = runs.RunStore.open(folder)
    assert rs.run_count == 5 and set(rs.layer.tolist()) == {0}
    rs.release()
    assert [la["layer"] for la in store.read_json(folder / "labels.json")] == ["TEXT"]
    idx = runs.BucketIndex(folder)
    assert idx.query((9, -1, 11, 31)).tolist() == [1]
    idx.release()
    assert (folder / "thumb.png").is_file() and d["georef"] is None


def test_crs_placement_scales_by_units(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    insp = inspect_ready(client, project_id, wait_job, _site_dxf(tmp_path, insunits=4, scale=1000.0))
    d = build_drawing(
        client, project_id, wait_job, insp["id"], placement={"method": "crs", "crs": "EPSG:32633"}
    )
    g = d["georef"]
    assert (
        g["method"] == "crs" and g["transform"] == [0.001, 0.0, 0.0, 0.0, 0.001, 0.0] and g["epsg"] == 32633
    )
    assert d["bounds_site"] == pytest.approx([0.0, 0.0, 40.0, 30.0])


@pytest.mark.parametrize(
    ("placement", "code"),
    [
        ({"method": "crs", "crs": "EPSG:4326"}, "invalid_placement"),
        ({"method": "crs", "crs": "EPSG:1"}, "invalid_placement"),
        ({"method": "crs"}, "invalid_placement"),
        ({"method": "embedded"}, "invalid_placement"),
    ],
)
def test_crs_refusals(client, project_id, wait_job, tmp_path, placement, code):
    insp = inspect_ready(client, project_id, wait_job, _site_dxf(tmp_path))
    r = client.post(
        f"{BASE}/{project_id}/drawings",
        json={"inspection_id": insp["id"], "name": "S", "placement": placement},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_units_are_required_when_the_file_has_none_we_know(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, _site_dxf(tmp_path, insunits=1))  # inches
    assert insp["units"] is None
    body = {"inspection_id": insp["id"], "name": "S", "placement": {"method": "crs", "crs": "EPSG:32633"}}
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_placement"
    body["placement"]["units"] = "metre"
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 202
    assert (
        wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    )  # F18: no job outlives the test


def test_landxml_builds(client, project_id, wait_job, tmp_path):
    body = (
        "<PlanFeatures><PlanFeature><CoordGeom><Line><Start>0 0</Start><End>10 10</End></Line>"
        "</CoordGeom></PlanFeature></PlanFeatures>"
    )
    insp = inspect_ready(client, project_id, wait_job, write_landxml(tmp_path / "f.xml", body))
    d = build_drawing(
        client, project_id, wait_job, insp["id"], placement={"method": "crs", "crs": "EPSG:32633"}
    )
    assert d["format"] == "landxml" and d["status"] == "ready" and d["extent_src"] == [0.0, 0.0, 10.0, 10.0]


def test_a_placement_in_the_wrong_units_warns(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    insp = inspect_ready(client, project_id, wait_job, _site_dxf(tmp_path, insunits=4, scale=1000.0))
    d = build_drawing(client, project_id, wait_job, insp["id"])
    pts = [
        {"src": [0, 0], "dst": [500000, 4983000]},
        {"src": [40000, 0], "dst": [540000, 4983000]},
    ]  # mm read as m
    r = client.put(
        f"{BASE}/{project_id}/drawings/{d['id']}/georef",
        json={"model": "similarity", "points": pts, "dst_frame": "site"},
    )
    assert [w["code"] for w in r.json()["georef"]["warnings"]] == ["scale_mismatch"]


def test_an_off_layer_is_hidden_from_the_start(client, project_id, wait_job, tmp_path):
    doc = new_doc()
    doc.layers.add("HIDDEN").off()
    doc.modelspace().add_line((0, 0), (1, 1), dxfattribs={"layer": "HIDDEN"})
    doc.modelspace().add_line((0, 0), (1, 0), dxfattribs={"layer": "SHOWN"})
    insp = inspect_ready(client, project_id, wait_job, save(doc, tmp_path / "h.dxf"))
    d = build_drawing(client, project_id, wait_job, insp["id"])
    assert d["layer_state"]["hidden_layers"] == ["HIDDEN"]


def test_a_layer_with_no_entities_is_unknown(client, project_id, wait_job, tmp_path):
    doc = new_doc()
    doc.modelspace().add_line((0, 0), (1, 1), dxfattribs={"layer": "A"})
    doc.layers.add("EMPTY")
    insp = inspect_ready(client, project_id, wait_job, save(doc, tmp_path / "x.dxf"))
    assert [la["name"] for la in insp["layers"]] == ["A"]
    r = client.post(
        f"{BASE}/{project_id}/drawings",
        json={"inspection_id": insp["id"], "name": "X", "layers": ["EMPTY"], "placement": {"method": "none"}},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
