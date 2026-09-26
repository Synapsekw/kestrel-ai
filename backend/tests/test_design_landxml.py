"""The streamed LandXML reader (spec §7, §15.3 LandXML, §16.2, §16.3, §16.5)."""

import shutil
import tracemalloc

import numpy as np
import pytest
from design_landxml import grid_tin, write_landxml
from designs import E0, N0
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces.design import landxml, store
from app.surfaces.design.units import unit_to_m


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    return landxml.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None), idir


@pytest.mark.parametrize("version", [None, "1.0", "1.2", "2.0"])
def test_every_namespace_reads(tmp_path, version):
    pts, faces = grid_tin(5, 4)
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}], version=version)
    res, _ = read(src, tmp_path)
    (c,) = res.candidates
    assert (c.id, c.kind, c.name, c.geometry) == ("c0", "tin_surface", "EG", "faces")
    assert (c.point_count, c.face_count) == (20, len(faces)) and c.default_selected


def test_points_are_northing_easting_elevation(tmp_path):
    e = np.array([E0, E0 + 100, E0 + 100, E0])
    n = np.array([N0, N0, N0 + 50, N0 + 50])
    pts = np.column_stack([e, n, [1.0, 2.0, 3.0, 4.0]])
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": [[0, 1, 2], [0, 2, 3]]}])
    res, idir = read(src, tmp_path)
    assert res.candidates[0].bounds_file == [E0, N0, E0 + 100, N0 + 50]
    cached = store.read_candidate(store.candidate_dir(idir, "c0")).points
    assert cached[:, 0].min() == E0 and cached[:, 1].max() == N0 + 50  # x = easting, the 2nd value


def test_invisible_faces_and_sparse_ids(tmp_path):
    pts, faces = grid_tin(3, 3)
    ids = [10 * (k + 7) for k in range(len(pts))]
    src = write_landxml(
        tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces, "ids": ids, "invisible": [0]}]
    )
    res, idir = read(src, tmp_path)
    c = res.candidates[0]
    assert c.face_count == len(faces) - 1 and c.entity_counts == {"invisible_faces": 1}
    a = store.read_candidate(store.candidate_dir(idir, "c0"))
    np.testing.assert_allclose(a.points[a.faces[0]][:, :2], pts[faces[1]][:, :2])


def test_points_without_ids_take_their_sequence_number(tmp_path):
    pts, faces = grid_tin(3, 2)
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces, "ids": "none"}])
    res, idir = read(src, tmp_path)
    a = store.read_candidate(store.candidate_dir(idir, "c0"))
    assert a.faces.tolist() == faces.tolist()


@pytest.mark.parametrize(
    ("surface", "message"),
    [
        ({"ids": [1, 2, 3], "faces": [[0, 1, 2]], "missing": True}, "face refers to missing point 999"),
        ({"ids": [1, 2, 2], "faces": [[0, 1, 2]]}, "duplicate point id 2"),
    ],
)
def test_broken_ids_fail_with_the_defect(tmp_path, surface, message):
    pts = np.array([[E0, N0, 1], [E0 + 1, N0, 1], [E0, N0 + 1, 1]], float)
    s = {"name": "EG", "points": pts, "ids": surface["ids"], "faces": surface["faces"]}
    src = write_landxml(tmp_path / "s.xml", [s])
    if surface.get("missing"):
        src.write_text(src.read_text().replace("<F>1 2 3</F>", "<F>1 2 999</F>"))
    with pytest.raises(JobFailure, match=message):
        read(src, tmp_path)


def test_points_without_elevations_fail(tmp_path):
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "raw_points": ["2800000 500000"], "faces": []}])
    with pytest.raises(JobFailure, match="surface 'EG' has points without elevations"):
        read(src, tmp_path)


def test_non_numeric_points_fail(tmp_path):
    src = write_landxml(
        tmp_path / "s.xml", [{"name": "EG", "raw_points": ["2800000 500000 nan"], "faces": []}]
    )
    with pytest.raises(JobFailure, match="not three numbers"):
        read(src, tmp_path)


def test_a_failed_read_leaves_no_open_handles(tmp_path):
    """Hardening (ruling c): a JobFailure raised mid-surface must not leave points.f64/faces.i32/
    ids.i64/faces_ids.i64 open — on Windows an open handle blocks deleting the inspection folder,
    exactly the shape of the race phase_inspect.run's cancel path has to survive."""
    s = {"name": "EG", "raw_points": ["2800000 500000 nan"], "faces": []}
    src = write_landxml(tmp_path / "s.xml", [s])
    idir = tmp_path / "insp"
    idir.mkdir()
    with pytest.raises(JobFailure, match="not three numbers"):
        landxml.inspect_file(src, idir, progress=lambda f, m: None, check_cancelled=lambda: None)
    shutil.rmtree(idir)  # would raise PermissionError on Windows if any handle were still open


def test_huge_point_id_fails_cleanly(tmp_path):
    """Hardening: a point id outside int64 range would otherwise raise OverflowError from the
    ids.i64 array append deep inside add_point; _id() range-checks first and fails with the same
    'is not a number' shape as any other unparsable id."""
    pts, faces = grid_tin(3, 3)
    ids = [10**20 + k for k in range(len(pts))]
    src = write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces, "ids": ids}])
    with pytest.raises(JobFailure, match="is not a number"):
        read(src, tmp_path)


def test_grid_and_points_only_surfaces_are_blocked(tmp_path):
    pts, faces = grid_tin(3, 3)
    src = write_landxml(
        tmp_path / "s.xml",
        [
            {"name": "Grid", "points": pts, "faces": faces, "surf_type": "grid"},
            {"name": "Pts", "points": pts, "faces": []},
        ],
    )
    res, _ = read(src, tmp_path)
    grid_c, pts_c = res.candidates
    assert [n.to_json() for n in grid_c.notes] == [
        {"code": "not_tin", "level": "block", "message": "grid-type LandXML surfaces aren't supported"}
    ]
    assert pts_c.notes[0].message == "points only — no triangles" and pts_c.geometry == "points"
    assert not grid_c.default_selected and not pts_c.default_selected


def test_two_surfaces_are_two_candidates_and_the_bigger_is_default(tmp_path):
    small, big = grid_tin(3, 3), grid_tin(6, 6)
    src = write_landxml(
        tmp_path / "s.xml",
        [
            {"name": "Small", "points": small[0], "faces": small[1]},
            {"name": "Big", "points": big[0], "faces": big[1]},
        ],
    )
    res, _ = read(src, tmp_path)
    assert [(c.id, c.name, c.default_selected) for c in res.candidates] == [
        ("c0", "Small", False),
        ("c1", "Big", True),
    ]


@pytest.mark.parametrize(
    ("units", "h", "v", "z100"),
    [
        (("Metric", "meter", None), "metre", "metre", 100.0),
        (("Metric", "meter", "millimeter"), "metre", "millimetre", 0.1),
        (("Imperial", "foot", None), "international_foot", "international_foot", 30.48),
        (("Imperial", "USSurveyFoot", None), "us_survey_foot", "us_survey_foot", 30.480060960121920),
    ],
)
def test_units(tmp_path, units, h, v, z100):
    pts, faces = grid_tin(2, 2)
    res, _ = read(
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}], units=units),
        tmp_path,
    )
    d = res.detected
    assert (d.horizontal_unit, d.vertical_unit) == (h, v)
    assert d.unit_source == f"LandXML <{units[0]} linearUnit={units[1]}>"
    assert 100 * unit_to_m(d.vertical_unit) == pytest.approx(z100, rel=1e-12)


def test_unmapped_linear_unit_is_reported_as_not_supported(tmp_path):
    """Hardening: an unmapped LandXML linearUnit (kilometer, inch, mile, ...) must not read as a
    silently-resolved unit — unit_source says so instead."""
    pts, faces = grid_tin(2, 2)
    s = [{"name": "EG", "points": pts, "faces": faces}]
    res, _ = read(write_landxml(tmp_path / "s.xml", s, units=("Metric", "kilometer", None)), tmp_path)
    assert res.detected.horizontal_unit is None
    assert res.detected.unit_source == "LandXML linearUnit=kilometer (not supported)"


def test_coordinate_system_epsg_wkt_and_absent(tmp_path):
    pts, faces = grid_tin(2, 2)
    s = [{"name": "EG", "points": pts, "faces": faces}]
    by_code, _ = read(
        write_landxml(tmp_path / "a.xml", s, crs={"epsgCode": "32639", "name": "UTM 39N"}), tmp_path
    )
    assert (
        by_code.detected.epsg == 32639
        and by_code.detected.crs_source == "LandXML <CoordinateSystem epsgCode>"
    )
    assert by_code.detected.crs_hint == "UTM 39N"
    wkt = CRS.from_epsg(32639).to_wkt()
    by_wkt, _ = read(write_landxml(tmp_path / "b.xml", s, crs={"ogcWktCode": wkt}), tmp_path)
    assert (
        by_wkt.detected.epsg == 32639
        and by_wkt.detected.crs_source == "LandXML <CoordinateSystem ogcWktCode>"
    )
    none, _ = read(write_landxml(tmp_path / "c.xml", s, crs={}), tmp_path)
    assert none.detected.crs_wkt is None and none.detected.crs_source is None


def test_bom_crlf_and_units_after_the_crs(tmp_path):
    pts, faces = grid_tin(3, 3)
    src = write_landxml(
        tmp_path / "s.xml",
        [{"name": "EG", "points": pts, "faces": faces}],
        units=("Imperial", "USSurveyFoot", None),
        units_after_crs=True,
        bom=True,
        crlf=True,
    )
    res, _ = read(src, tmp_path)
    assert res.detected.horizontal_unit == "us_survey_foot" and res.candidates[0].face_count == len(faces)


def test_parse_memory_stays_flat(tmp_path):
    pts, faces = grid_tin(548, 548)
    assert len(pts) > 300_000
    src = write_landxml(tmp_path / "big.xml", [{"name": "EG", "points": pts, "faces": faces}])
    del pts, faces
    tracemalloc.start()
    base = tracemalloc.get_traced_memory()[0]
    res, _ = read(src, tmp_path)
    peak = tracemalloc.get_traced_memory()[1] - base
    tracemalloc.stop()
    assert res.candidates[0].point_count == 548 * 548
    assert peak < 50 * 2**20, f"parse peak {peak / 2**20:.0f} MB"


def test_inspect_through_the_api(client, project_id, wait_job, tmp_path):
    pts, faces = grid_tin(10, 10)
    src = write_landxml(tmp_path / "site.xml", [{"name": "EG", "points": pts, "faces": faces}])
    body = client.post(f"/api/v1/projects/{project_id}/design-inspections", json={"path": str(src)}).json()
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    iid = body["inspection"]["id"]
    got = client.get(f"/api/v1/projects/{project_id}/design-inspections/{iid}").json()
    assert got["detected"]["epsg"] == 32639 and got["candidates"][0]["face_count"] == len(faces)
    t = client.get(f"/api/v1/projects/{project_id}/design-inspections/{iid}/candidates/c0/thumbnail")
    assert t.status_code == 200
