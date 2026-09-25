"""The ezdxf reader (spec §8.1, §15.3 DXF)."""

import tracemalloc

import numpy as np
import pytest
from design_dxf import add_contours, add_faces, inject_unknown, new_doc, save
from designs import E0, N0, cone_contour_runs, two_triangle_plane
from ezdxf.math import Vec3

from app.surfaces.design import dxf, store
from app.surfaces.design.rasterise import SimpleLattice, rasterise_to_array


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    res = dxf.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None)
    return res, idir, {c.name: c for c in res.candidates}


def arrays(idir, cand):
    return store.read_candidate(store.candidate_dir(idir, cand.id))


def test_3dface_triangles_and_the_shorter_diagonal_split(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    v, t = two_triangle_plane()
    add_faces(msp, v, t, "TIN")
    quad = [(E0, N0, 0.0), (E0 + 10, N0, 0.0), (E0 + 10, N0 + 10, 5.0), (E0, N0 + 10, 0.0)]
    msp.add_3dface(quad, dxfattribs={"layer": "QUAD"})
    res, idir, by = read(save(doc, tmp_path / "f.dxf"), tmp_path)
    assert (
        by["TIN"].geometry == "faces" and by["TIN"].face_count == 2 and by["TIN"].entity_counts["3dface"] == 2
    )
    a = arrays(idir, by["QUAD"])
    assert a.faces.tolist() == [[0, 1, 3], [1, 2, 3]]  # |v1 - v3| = 14.1 < |v0 - v2| = 15.0
    out, _ = rasterise_to_array(a.points, a.faces, SimpleLattice(E0, N0 + 10, 1.0, 10, 10))
    assert out[4, 4] == pytest.approx(0.0, abs=1e-6)  # centre (4.5, 5.5) lies on the 1-3 diagonal
    assert [c.default_selected for c in res.candidates] == [True, True]


def test_mesh_polyface_and_polymesh(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    mesh = msp.add_mesh(dxfattribs={"layer": "MESH"})
    with mesh.edit_data() as d:
        d.vertices = [
            (E0, N0, 0),
            (E0 + 2, N0, 0),
            (E0 + 3, N0 + 2, 0),
            (E0 + 1, N0 + 3, 0),
            (E0 - 1, N0 + 2, 0),
        ]
        d.faces = [[0, 1, 2, 3, 4]]
    pf = msp.add_polyface(dxfattribs={"layer": "PF"})
    pf.append_face([(E0, N0, 0), (E0 + 10, N0, 1), (E0 + 10, N0 + 10, 2), (E0, N0 + 10, 3)])
    pm = msp.add_polymesh(size=(3, 3), dxfattribs={"layer": "PM"})
    for i in range(3):
        for j in range(3):
            pm.set_mesh_vertex((i, j), (E0 + 10 * i, N0 + 10 * j, float(i + j)))
    _, _, by = read(save(doc, tmp_path / "m.dxf"), tmp_path)
    assert by["MESH"].face_count == 3 and by["MESH"].entity_counts["mesh"] == 1
    assert by["PF"].face_count == 2 and by["PF"].entity_counts["polyface"] == 1
    assert by["PM"].face_count == 8 and by["PM"].entity_counts["polymesh"] == 1


def test_polylines_lines_and_points_are_runs(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_polyline3d([(E0, N0, 1), (E0 + 5, N0, 2), (E0 + 5, N0 + 5, 3)], dxfattribs={"layer": "P3D"})
    msp.add_lwpolyline([(E0, N0), (E0 + 5, N0)], dxfattribs={"layer": "LW", "elevation": 7.0})
    msp.add_polyline2d([(E0, N0), (E0, N0 + 5)], dxfattribs={"layer": "P2D", "elevation": (0, 0, 4.0)})
    msp.add_line((E0, N0, 1), (E0 + 1, N0, 2), dxfattribs={"layer": "LINES"})
    msp.add_point((E0 + 3, N0 + 3, 9), dxfattribs={"layer": "LINES"})
    _, idir, by = read(save(doc, tmp_path / "p.dxf"), tmp_path)
    p3d = arrays(idir, by["P3D"])
    assert (
        by["P3D"].geometry == "points"
        and p3d.points[:, 2].tolist() == [1, 2, 3]
        and p3d.runs.tolist() == [0, 3]
    )
    assert arrays(idir, by["LW"]).points[:, 2].tolist() == [7.0, 7.0]
    assert arrays(idir, by["P2D"]).points[:, 2].tolist() == [4.0, 4.0]
    lines = arrays(idir, by["LINES"])
    assert lines.runs.tolist() == [0, 2, 3] and by["LINES"].entity_counts["line"] == 1
    assert by["LINES"].entity_counts["point"] == 1


def test_an_upside_down_extrusion_goes_through_the_ocs(tmp_path):
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(1, 2), (3, 4)], dxfattribs={"layer": "FLIP", "elevation": 5.0, "extrusion": (0, 0, -1)}
    )
    _, idir, by = read(save(doc, tmp_path / "o.dxf"), tmp_path)
    assert arrays(idir, by["FLIP"]).points.tolist() == [[-1.0, 2.0, -5.0], [-3.0, 4.0, -5.0]]


def test_nested_inserts_count_layer_zero_on_the_insert_layer(tmp_path):
    doc = new_doc()
    faces = doc.blocks.new("FACES")
    faces.add_3dface([(0, 0, 1), (1, 0, 1), (0, 1, 1)], dxfattribs={"layer": "0"})
    outer = doc.blocks.new("OUTER")
    outer.add_blockref("FACES", (10, 0, 0), dxfattribs={"layer": "0"})
    doc.modelspace().add_blockref("OUTER", (100, 0, 0), dxfattribs={"layer": "TIN"})
    _, idir, by = read(save(doc, tmp_path / "i.dxf"), tmp_path)
    assert set(by) == {"TIN"}
    assert sorted(arrays(idir, by["TIN"]).points[:, 0].tolist()) == [110.0, 110.0, 111.0]


def test_all_zero_layers_are_flagged_and_not_selected(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_lwpolyline([(E0, N0), (E0 + 5, N0)], dxfattribs={"layer": "FLAT"})
    add_contours(msp, *cone_contour_runs(32), layer="CONTOURS")
    res, _, by = read(save(doc, tmp_path / "z.dxf"), tmp_path)
    assert [n.code for n in by["FLAT"].notes] == ["no_heights"]
    assert by["FLAT"].notes[0].message == "all elevations are 0 — 2D linework?"
    assert not by["FLAT"].default_selected and by["CONTOURS"].default_selected


def test_faces_win_the_default_selection(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane(), "TIN")
    add_contours(msp, *cone_contour_runs(32), layer="CONTOURS")
    _, _, by = read(save(doc, tmp_path / "d.dxf"), tmp_path)
    assert by["TIN"].default_selected and not by["CONTOURS"].default_selected


def test_civil_3d_objects_are_counted_as_unsupported(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane(), "TIN")
    path = save(doc, tmp_path / "c3d.dxf")
    inject_unknown(path, "AECC_TIN_SURFACE", "TIN", msp.layout_key)
    _, _, by = read(path, tmp_path)
    assert by["TIN"].entity_counts["unsupported"] == 1
    (note,) = [n for n in by["TIN"].notes if n.code == "unsupported_entities"]
    assert note.message.startswith("1 Civil 3D objects (AECC) can't be read")


def test_bulges_are_chorded_and_noted(tmp_path):
    doc = new_doc()
    doc.modelspace().add_lwpolyline(
        [(0, 0, 0.5), (10, 0, 0)], format="xyb", dxfattribs={"layer": "ARC", "elevation": 3.0}
    )
    _, _, by = read(save(doc, tmp_path / "b.dxf"), tmp_path)
    assert any(n.code == "chorded_arcs" and n.message == "1 arcs were chorded" for n in by["ARC"].notes)


def test_a_layer_of_text_has_nothing_to_use(tmp_path):
    doc = new_doc()
    doc.modelspace().add_text("KEEP OUT", dxfattribs={"layer": "TEXT"})
    _, _, by = read(save(doc, tmp_path / "t.dxf"), tmp_path)
    assert by["TEXT"].geometry == "none" and by["TEXT"].notes[0].level == "block"


@pytest.mark.parametrize(
    ("insunits", "unit", "source"),
    [
        (0, "metre", "DXF $INSUNITS=0 (unitless; metres assumed)"),
        (2, "international_foot", "DXF $INSUNITS=2"),
        (4, "millimetre", "DXF $INSUNITS=4"),
        (6, "metre", "DXF $INSUNITS=6"),
        (21, "us_survey_foot", "DXF $INSUNITS=21"),
        (1, None, "DXF $INSUNITS=1 (not supported; choose the unit)"),
    ],
)
def test_insunits(tmp_path, insunits, unit, source):
    doc = new_doc(insunits)
    add_faces(doc.modelspace(), *two_triangle_plane())
    res, _, _ = read(save(doc, tmp_path / "u.dxf"), tmp_path)
    assert res.detected.horizontal_unit == unit and res.detected.vertical_unit == unit
    assert res.detected.unit_source.startswith(source)
    assert res.internal == {"insunits": insunits}


def test_a_binary_dxf_reads_the_same(tmp_path):
    doc = new_doc()
    add_faces(doc.modelspace(), *two_triangle_plane())
    _, _, by = read(save(doc, tmp_path / "bin.dxf", binary=True), tmp_path)
    assert by["TIN"].face_count == 2


def test_geodata_gives_an_unverified_hint(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    add_faces(msp, *two_triangle_plane())
    geo = msp.new_geodata()
    geo.coordinate_system_definition = '<Dictionary><ProjectedCoordinateSystem id="UTM84-39N"/></Dictionary>'
    res, _, _ = read(save(doc, tmp_path / "g.dxf"), tmp_path)
    assert res.detected.crs_hint == "GEODATA: UTM84-39N" and res.detected.crs_wkt is None


def test_the_ram_factor_holds_on_a_20_mb_dxf(tmp_path):
    doc = new_doc()
    msp = doc.modelspace()
    rng = np.random.default_rng(0)
    xy = rng.uniform(0, 1000, (90_000, 2)) + [E0, N0]
    for x, y in xy:
        msp.add_3dface([Vec3(x, y, 1), Vec3(x + 1, y, 2), Vec3(x, y + 1, 3)], dxfattribs={"layer": "TIN"})
    path = save(doc, tmp_path / "big.dxf")
    del doc, msp
    size = path.stat().st_size
    assert size > 20 * 2**20
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    read(path, tmp_path)
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert peak <= dxf.DXF_RAM_FACTOR * size, f"measured {peak / size:.1f} x the file size"


def test_inspect_through_the_api(client, project_id, wait_job, tmp_path):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(64), layer="CONTOURS", kind="lwpolyline")
    src = save(doc, tmp_path / "contours.dxf")
    body = client.post(f"/api/v1/projects/{project_id}/design-inspections", json={"path": str(src)}).json()
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    got = client.get(f"/api/v1/projects/{project_id}/design-inspections/{body['inspection']['id']}").json()
    (c,) = got["candidates"]
    assert (c["name"], c["geometry"], c["entity_counts"]["lwpolyline"]) == ("CONTOURS", "points", 20)
