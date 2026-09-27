"""DXF drawings (spec §8.2 DXF, §15 "DXF flatten (arc, bulge, circle, spline sagitta <= 1 cm; INSERT
nesting; OCS)"; plan Task 10)."""

import math

import numpy as np
import pytest
from design_dxf import new_doc, save
from drawings_helpers import BASE
from shapely.geometry import LineString

from app.drawings import dxf_flatten, runs, store
from app.jobs.cancellation import JobFailure


def _inspect(tmp_path, doc, name="d.dxf"):
    path = save(doc, tmp_path / name)
    idir = tmp_path / "insp"
    (idir / "thumbs").mkdir(parents=True)
    result = dxf_flatten.inspect_file(path, idir, progress=lambda f, m="": None, check_cancelled=lambda: None)
    rs = runs.RunStore.open(store.lines_dir(idir))
    polylines = [np.asarray(rs.lines[rs.runs[k] : rs.runs[k + 1]]).copy() for k in range(rs.run_count)]
    layer_of = [result.layers[i]["name"] for i in rs.layer]
    rs.release()
    labels = store.read_json(store.lines_dir(idir) / "labels.json")
    return result, polylines, layer_of, labels


def _max_sagitta(pts, centre, radius):
    """The largest gap between the true arc and each chord's midpoint."""
    mids = (pts[1:] + pts[:-1]) / 2
    return float(np.max(radius - np.hypot(mids[:, 0] - centre[0], mids[:, 1] - centre[1])))


def test_bulge_arc_and_circle_hold_the_sagitta(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0, 0, 0, 1), (10, 0, 0, 0, 0)], format="xyseb", dxfattribs={"layer": "A"})
    msp.add_arc((50, 50), 7, 0, 120, dxfattribs={"layer": "A"})
    msp.add_circle((100, 100), 20, dxfattribs={"layer": "B"})
    result, pls, layers, _ = _inspect(tmp_path, doc)
    bulge, arc, circle = pls
    assert np.allclose(np.hypot(bulge[:, 0] - 5, bulge[:, 1]), 5, atol=1e-9)
    assert _max_sagitta(bulge, (5, 0), 5) <= 0.01 + 1e-9
    assert _max_sagitta(arc, (50, 50), 7) <= 0.01 + 1e-9
    assert np.allclose(circle[0], circle[-1]) and _max_sagitta(circle, (100, 100), 20) <= 0.01 + 1e-9
    assert layers == ["A", "A", "B"] and result.units == "metre"
    assert [(la["name"], la["entity_count"]) for la in result.layers] == [("A", 2), ("B", 1)]


def test_spline_and_ellipse_hold_the_sagitta(tmp_path):
    from ezdxf import path

    doc = new_doc()
    msp = doc.modelspace()
    spline = msp.add_spline([(0, 0), (10, 20), (30, 10), (40, 40)])
    ellipse = msp.add_ellipse((0, 0), major_axis=(30, 0), ratio=0.4)
    dense = [
        LineString([(v.x, v.y) for v in path.make_path(e).flattening(0.0001)]) for e in (spline, ellipse)
    ]
    _, pls, _, _ = _inspect(tmp_path, doc)
    for got, ref in zip(pls, dense, strict=True):
        assert LineString(got).hausdorff_distance(ref) <= 0.0101


def test_units_scale_the_sagitta(tmp_path):
    doc = new_doc(insunits=4)  # millimetres
    doc.modelspace().add_circle((0, 0), 1000)
    result, pls, _, _ = _inspect(tmp_path, doc)
    assert result.units == "millimetre"
    assert _max_sagitta(pls[0], (0, 0), 1000) <= 10.0 + 1e-6  # 1 cm in mm
    assert _max_sagitta(pls[0], (0, 0), 1000) > 1.0  # not flattened at 1 cm-as-mm


def test_insert_nesting_inherits_layer_zero(tmp_path):
    doc = new_doc()
    inner = doc.blocks.new("INNER")
    inner.add_line((0, 0), (1, 0), dxfattribs={"layer": "0"})
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("INNER", (10, 0), dxfattribs={"layer": "0"})
    doc.modelspace().add_blockref("OUTER", (100, 200), dxfattribs={"layer": "WALLS", "rotation": 90})
    _, pls, layers, _ = _inspect(tmp_path, doc)
    assert layers == ["WALLS"]
    assert np.allclose(pls[0], [[100, 210], [100, 211]], atol=1e-9)


def test_ocs_arcs_are_in_world_coordinates(tmp_path):
    doc = new_doc()
    doc.modelspace().add_arc((10, 0), 1, 0, 90, dxfattribs={"extrusion": (0, 0, -1)})
    _, pls, _, _ = _inspect(tmp_path, doc)
    assert np.allclose(np.hypot(pls[0][:, 0] + 10, pls[0][:, 1]), 1, atol=1e-9)  # centre (-10, 0) in WCS


def test_hatch_boundaries_become_closed_outlines(tmp_path):
    doc = new_doc()
    h = doc.modelspace().add_hatch()
    h.paths.add_polyline_path([(0, 0), (4, 0), (4, 3)], is_closed=True)
    _, pls, _, _ = _inspect(tmp_path, doc)
    assert np.allclose(pls[0][0], pls[0][-1]) and len(pls[0]) == 4


def test_text_and_mtext_are_labels(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 10))
    msp.add_text("GATE A", height=2.5, rotation=30, dxfattribs={"layer": "TXT"}).set_placement((1, 2))
    msp.add_mtext("PIT\\PNORTH", dxfattribs={"layer": "TXT", "char_height": 1.5, "insert": (5, 6)})
    _, _, _, labels = _inspect(tmp_path, doc)
    assert len(labels) == 2
    assert labels[0] == {
        "text": "GATE A",
        "x": 1.0,
        "y": 2.0,
        "height": 2.5,
        "rotation": 30.0,
        "layer": "TXT",
    }
    assert labels[1]["text"] == "PIT\nNORTH" and labels[1]["height"] == 1.5
    assert (labels[1]["x"], labels[1]["y"]) == (5.0, 6.0)


def test_an_off_layer_is_not_visible_by_default(tmp_path):
    doc = new_doc()
    doc.layers.add("HIDDEN", color=1).off()
    doc.modelspace().add_line((0, 0), (1, 1), dxfattribs={"layer": "HIDDEN"})
    result, _, _, _ = _inspect(tmp_path, doc)
    assert result.layers == [
        {"name": "HIDDEN", "colour": "#ff0000", "entity_count": 1, "visible_default": False}
    ]


def test_unsupported_entities_are_counted(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_line((0, 0), (1, 1))
    msp.add_3dface([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
    result, _, _, _ = _inspect(tmp_path, doc)
    assert any(w["code"] == "unsupported_entities" and "1" in w["message"] for w in result.warnings)


@pytest.mark.parametrize("fill", ["nothing", "points"])
def test_no_lines_arcs_or_text_fails(tmp_path, fill):
    doc = new_doc()
    if fill == "points":
        doc.modelspace().add_point((1, 1))
    with pytest.raises(JobFailure, match="no lines, arcs or text found"):
        _inspect(tmp_path, doc)


def test_all_zero_extent_is_an_empty_drawing(tmp_path):
    doc = new_doc()
    doc.modelspace().add_text("X", height=1).set_placement((0, 0))
    with pytest.raises(JobFailure, match="empty drawing"):
        _inspect(tmp_path, doc)


def test_the_api_reads_a_dxf(client, project_id, wait_job, tmp_path):
    doc = new_doc(insunits=6)
    doc.modelspace().add_line((500000, 4983000), (500050, 4983020), dxfattribs={"layer": "ROADS"})
    path = save(doc, tmp_path / "site.dxf")
    r = client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(path)})
    wait_job(project_id, r.json()["job"]["id"])
    insp = client.get(f"{BASE}/{project_id}/drawing-inspections/{r.json()['inspection']['id']}").json()
    assert insp["state"] == "ready" and insp["format"] == "dxf" and insp["units"] == "metre"
    assert insp["extent_src"] == [500000.0, 4983000.0, 500050.0, 4983020.0]
    assert [la["name"] for la in insp["layers"]] == ["ROADS"]
    thumb = client.get(f"{BASE}/{project_id}/drawing-inspections/{insp['id']}/pages/1/thumbnail")
    assert thumb.status_code == 200


def test_a_dwg_named_dxf_is_refused(client, project_id, tmp_path):
    fake = tmp_path / "site.dxf"
    fake.write_bytes(b"AC1032" + b"\0" * 64)
    r = client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(fake)})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"] == {"reason": "dwg"}


def test_sagitta_constant():
    assert math.isclose(dxf_flatten.SAGITTA_M, 0.01)
