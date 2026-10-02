"""drawing_view / drawing_text (spec §7.3; Review Focus 1)."""

import io

import pytest
from design_dxf import new_doc, save
from drawings_helpers import build_drawing, inspect_ready, write_landxml
from look_helpers import raster_pdf, vector_pdf
from PIL import Image

from app.asset_models.look import clamp_region
from app.asset_models.look.drawing import LookError, drawing_text, drawing_view


def _import(client, project_id, wait_job, path) -> str:
    insp = inspect_ready(client, project_id, wait_job, path)
    return build_drawing(client, project_id, wait_job, insp["id"])["id"]


def test_view_whole_page_is_bounded(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    img = drawing_view(handle, did, max_side=300)
    assert max(img.width, img.height) == 300
    assert Image.open(io.BytesIO(img.jpeg)).size == (img.width, img.height)


def test_view_region_crops(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    full = drawing_view(handle, did, max_side=1600)
    crop = drawing_view(handle, did, [0.5, 0.5, 1.0, 1.0], max_side=1600)
    assert crop.width / crop.height == pytest.approx(full.width / full.height, rel=0.05)


def test_text_finds_title_block_with_positions(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    result = drawing_text(handle, did)
    texts = {s["text"].strip(): s["box"] for s in result.spans}
    assert "P-00212-DW-MD-143TD1" in texts
    x0, y0, x1, y1 = texts["P-00212-DW-MD-143TD1"]
    assert x0 > 0.7 and y0 > 0.8  # bottom-right, measured from the top-left
    region = drawing_text(handle, did, [0.0, 0.0, 0.6, 0.5])
    assert [s["text"].strip() for s in region.spans] == ["ID 4000"]


def test_drawing_text_raster_pdf_is_empty_with_note(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, raster_pdf(tmp_path / "scan.pdf"))
    result = drawing_text(handle, did)
    assert result.spans == []
    assert "no text layer" in result.note


def test_text_is_capped(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    result = drawing_text(handle, did, max_spans=1)
    assert len(result.spans) == 1 and result.truncated


def test_text_from_dxf(client, project_id, wait_job, handle, tmp_path):
    doc = new_doc(insunits=6)
    msp = doc.modelspace()
    msp.add_line((0, 0), (40, 0), dxfattribs={"layer": "WALLS"})
    msp.add_line((0, 0), (0, 30), dxfattribs={"layer": "WALLS"})
    msp.add_text("GATE", height=2, dxfattribs={"layer": "TEXT"}).set_placement((5, 5))
    did = _import(client, project_id, wait_job, save(doc, tmp_path / "site.dxf"))
    result = drawing_text(handle, did)
    assert [s["text"] for s in result.spans] == ["GATE"]
    fx, fy = result.spans[0]["box"][:2]
    assert 0 < fx < 0.5 and 0.5 < fy < 1  # near the bottom-left, measured from the top-left


def test_view_of_dxf_raises_look_error(client, project_id, wait_job, handle, tmp_path):
    doc = new_doc(insunits=6)
    msp = doc.modelspace()
    msp.add_line((0, 0), (40, 0), dxfattribs={"layer": "WALLS"})
    msp.add_line((0, 0), (0, 30), dxfattribs={"layer": "WALLS"})
    msp.add_text("GATE", height=2, dxfattribs={"layer": "TEXT"}).set_placement((5, 5))
    did = _import(client, project_id, wait_job, save(doc, tmp_path / "site.dxf"))
    with pytest.raises(LookError, match="drawing_text"):
        drawing_view(handle, did)


def test_unknown_drawing_raises(handle):
    with pytest.raises(LookError):
        drawing_view(handle, "00000000-0000-0000-0000-000000000000")


def _dxf_import(client, project_id, wait_job, tmp_path, *, text: bool) -> str:
    doc = new_doc(insunits=6)
    msp = doc.modelspace()
    msp.add_line((0, 0), (40, 0), dxfattribs={"layer": "WALLS"})
    msp.add_line((0, 0), (0, 30), dxfattribs={"layer": "WALLS"})
    if text:
        msp.add_text("GATE", height=2, dxfattribs={"layer": "TEXT"}).set_placement((5, 5))
    return _import(client, project_id, wait_job, save(doc, tmp_path / "site.dxf"))


def test_dxf_without_text_does_not_point_back_at_drawing_view(client, project_id, wait_job, handle, tmp_path):
    did = _dxf_import(client, project_id, wait_job, tmp_path, text=False)
    result = drawing_text(handle, did)
    assert result.spans == [] and "no text" in result.note
    assert "drawing_view" not in result.note


def test_region_that_empties_a_text_page_says_no_text_in_region(
    client, project_id, wait_job, handle, tmp_path
):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    result = drawing_text(handle, did, [0.0, 0.0, 0.02, 0.02])
    assert result.spans == []
    assert "no text in that region" in result.note.lower() and "scan" not in result.note


def test_landxml_text_and_view_do_not_point_at_each_other(client, project_id, wait_job, handle, tmp_path):
    body = (
        '<Alignments><Alignment name="Haul road"><CoordGeom><Line><Start>4983000 500000</Start>'
        "<End>4983000 500100</End></Line></CoordGeom></Alignment></Alignments>"
    )
    did = _import(client, project_id, wait_job, write_landxml(tmp_path / "a.xml", body))
    result = drawing_text(handle, did)
    assert result.spans == [] and "drawing_view" not in result.note
    with pytest.raises(LookError) as e:
        drawing_view(handle, did)
    assert "drawing_text" not in e.value.message


@pytest.mark.parametrize("fmt", ["pdf", "dxf"])
def test_unreadable_source_is_a_look_error_without_paths(client, project_id, wait_job, handle, tmp_path, fmt):
    if fmt == "pdf":
        src = vector_pdf(tmp_path / "v.pdf")
        did = _import(client, project_id, wait_job, src)
    else:
        did = _dxf_import(client, project_id, wait_job, tmp_path, text=True)
        src = tmp_path / "site.dxf"
    src.write_bytes(b"not a drawing at all")
    with pytest.raises(LookError) as e:
        drawing_text(handle, did)
    assert "can't be read" in e.value.message and str(tmp_path) not in e.value.message
    assert ("drawing_view" in e.value.message) == (fmt == "pdf")


@pytest.mark.parametrize(
    "region", [[0, 0, 1], [0, 0, 1, 1, 1], [0, 0, float("nan"), 1], "abcd", [0, 0, "x", 1]]
)
def test_bad_region_is_a_look_error(region):
    with pytest.raises(LookError, match=r"\[x0, y0, x1, y1\]"):
        clamp_region(region)


def test_tiny_region_still_yields_an_image(client, project_id, wait_job, handle, tmp_path):
    did = _import(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    img = drawing_view(handle, did, [0.5, 0.5, 0.5011, 0.5011])
    assert img.width >= 1 and img.height >= 1
