"""LandXML linework (spec §8.2 LandXML, §15 "LandXML breaklines and alignments, including the
northing-first rule"; plan Task 11)."""

import numpy as np
import pytest
from drawings_helpers import write_landxml

from app.drawings import landxml_lines, runs, store
from app.jobs.cancellation import JobFailure

SURFACE = """<Surfaces><Surface name="EG"><SourceData><Breaklines><Breakline>
<PntList3D>4983000 500000 100 4983010 500005 101 4983020 500000 102</PntList3D></Breakline></Breaklines>
</SourceData><Definition surfType="TIN"><Pnts><P id="1">4983000 500000 1</P><P id="2">4983000 500030 1</P>
<P id="3">4983040 500010 1</P><P id="4">4983010 500010 1</P></Pnts><Faces><F>1 2 3</F></Faces></Definition>
</Surface></Surfaces>"""
ALIGN = """<Alignments><Alignment name="Haul road"><CoordGeom>
<Line><Start>4983000 500000</Start><End>4983000 500100</End></Line>
<Curve rot="ccw" radius="50"><Start>4983000 500100</Start><Center>4983050 500100</Center>
<End>4983050 500150</End></Curve>
<Spiral><Start>4983050 500150</Start><PI>4983060 500160</PI><End>4983080 500165</End></Spiral>
</CoordGeom></Alignment></Alignments>"""


def _inspect(tmp_path, path):
    idir = tmp_path / "insp"
    (idir / "thumbs").mkdir(parents=True)
    result = landxml_lines.inspect_file(
        path, idir, progress=lambda f, m="": None, check_cancelled=lambda: None
    )
    rs = runs.RunStore.open(store.lines_dir(idir))
    pls = [np.asarray(rs.lines[rs.runs[k] : rs.runs[k + 1]]).copy() for k in range(rs.run_count)]
    names = [result.layers[i]["name"] for i in rs.layer]
    rs.release()
    return result, pls, names


def test_breaklines_are_northing_first(tmp_path):
    result, pls, names = _inspect(tmp_path, write_landxml(tmp_path / "s.xml", SURFACE))
    assert names[0] == "Breaklines"
    assert pls[0].tolist() == [[500000, 4983000], [500005, 4983010], [500000, 4983020]]
    assert result.units == "metre" and result.crs_hint.startswith("EPSG:32633")


def test_surface_hull_when_there_is_no_boundary(tmp_path):
    _, pls, names = _inspect(tmp_path, write_landxml(tmp_path / "s.xml", SURFACE))
    assert "EG hull" in names
    hull = pls[names.index("EG hull")]
    assert np.allclose(hull[0], hull[-1])
    assert {tuple(p) for p in hull[:-1]} == {(500000, 4983000), (500030, 4983000), (500010, 4983040)}


def test_a_boundary_wins_over_the_hull(tmp_path):
    body = SURFACE.replace(
        "</Breaklines>",
        "</Breaklines><Boundaries><Boundary><PntList2D>"
        "4983000 500000 4983000 500030 4983040 500010 4983000 500000"
        "</PntList2D></Boundary></Boundaries>",
    )
    _, pls, names = _inspect(tmp_path, write_landxml(tmp_path / "s.xml", body))
    assert "EG boundary" in names and "EG hull" not in names


def test_alignment_lines_curves_and_spirals(tmp_path):
    _, pls, names = _inspect(tmp_path, write_landxml(tmp_path / "a.xml", ALIGN))
    assert names == ["Alignments"] * 3
    line, curve, spiral = pls
    assert line.tolist() == [[500000, 4983000], [500100, 4983000]]
    r = np.hypot(curve[:, 0] - 500100, curve[:, 1] - 4983050)
    assert np.allclose(r, 50, atol=1e-6) and np.allclose(curve[-1], [500150, 4983050])
    mids = (curve[1:] + curve[:-1]) / 2
    assert np.max(50 - np.hypot(mids[:, 0] - 500100, mids[:, 1] - 4983050)) <= 0.05 + 1e-9
    assert spiral.tolist() == [[500150, 4983050], [500160, 4983060], [500165, 4983080]]


def test_plan_features_and_feet(tmp_path):
    body = (
        "<PlanFeatures><PlanFeature name='Fence'><CoordGeom><IrregularLine><PntList2D>"
        "100 200 110 210 120 200</PntList2D></IrregularLine></CoordGeom></PlanFeature></PlanFeatures>"
    )
    result, pls, names = _inspect(
        tmp_path, write_landxml(tmp_path / "f.xml", body, units='linearUnit="USSurveyFoot"')
    )
    assert names == ["Plan features"] and result.units == "us_survey_foot"
    assert pls[0].tolist() == [[200, 100], [210, 110], [200, 120]]


def test_without_a_namespace(tmp_path):
    _, pls, _ = _inspect(tmp_path, write_landxml(tmp_path / "n.xml", ALIGN, ns=False))
    assert len(pls) == 3


def test_no_linework_fails(tmp_path):
    with pytest.raises(JobFailure, match="no lines, arcs or text found"):
        _inspect(tmp_path, write_landxml(tmp_path / "e.xml", ""))
