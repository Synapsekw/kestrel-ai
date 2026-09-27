"""PDF drawings (spec §8.2 PDF, §13 memory, §14 PDF errors; plan Tasks 4 and 6)."""

import io
import math
import sys
import tracemalloc

import numpy as np
import pytest
import rasterio
from drawings_helpers import BASE, build_drawing, inspect_ready, write_pdf, write_png
from PIL import Image

from app.drawings import pdf, store


def _inspect(client, project_id, wait_job, path):
    r = client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(path)})
    assert r.status_code == 202, r.text
    body = r.json()
    wait_job(project_id, body["job"]["id"])
    return client.get(f"{BASE}/{project_id}/drawing-inspections/{body['inspection']['id']}").json()


def test_pages_sizes_and_thumbnails(client, project_id, wait_job, tmp_path):
    src = write_pdf(tmp_path / "set.pdf", [(595.0, 842.0), (842.0, 595.0), (300.0, 200.0)])
    insp = inspect_ready(client, project_id, wait_job, src)
    assert insp["format"] == "pdf" and insp["page_count"] == 3
    assert insp["pages"] == [
        {"page": 1, "width_pt": 595.0, "height_pt": 842.0},
        {"page": 2, "width_pt": 842.0, "height_pt": 595.0},
        {"page": 3, "width_pt": 300.0, "height_pt": 200.0},
    ]
    for n in (1, 2, 3):
        r = client.get(f"{BASE}/{project_id}/drawing-inspections/{insp['id']}/pages/{n}/thumbnail")
        assert r.status_code == 200 and max(Image.open(io.BytesIO(r.content)).size) == 160


def test_pages_and_thumbnails_stop_at_fifty(client, project_id, wait_job, handle, tmp_path):
    insp = inspect_ready(
        client, project_id, wait_job, write_pdf(tmp_path / "long.pdf", [(100.0, 100.0)] * 52)
    )
    assert insp["page_count"] == 52 and len(insp["pages"]) == 50
    idir = store.inspection_dir(handle, insp["id"])
    assert len(store.read_json(idir / "pages.json")["pages"]) == 52
    url = f"{BASE}/{project_id}/drawing-inspections/{insp['id']}/pages"
    assert client.get(f"{url}/50/thumbnail").status_code == 200


def test_encrypted_pdf_fails_readably(client, project_id, wait_job, tmp_path):
    insp = _inspect(
        client, project_id, wait_job, write_pdf(tmp_path / "locked.pdf", [(200.0, 200.0)], encrypt="secret")
    )
    assert insp["state"] == "failed" and "password-protected" in insp["error"]


def test_a_pdf_without_pages_fails_readably(client, project_id, wait_job, tmp_path):
    src = tmp_path / "empty.pdf"
    src.write_bytes(
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj"
        b" trailer<</Root 1 0 R>>\n%%EOF"
    )
    insp = _inspect(client, project_id, wait_job, src)
    assert insp["state"] == "failed"
    assert "no pages" in insp["error"] or "can't be read as PDF" in insp["error"]


def test_pdfium_missing_disables_only_pdf(client, project_id, tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "pypdfium2", None)
    r = client.post(
        f"{BASE}/{project_id}/drawing-inspections",
        json={"path": str(write_pdf(tmp_path / "a.pdf", [(100.0, 100.0)]))},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "pdf_unavailable"
    png = write_png(tmp_path / "b.png", 10, 10)
    assert client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(png)}).status_code == 202


@pytest.mark.parametrize(
    ("w", "h", "want"),
    [(595.0, 842.0, 1710), (2384.0, 3370.0, 427), (14400.0, 14400.0, 86), (14400.0, 1440.0, 100)],
)
def test_max_dpi_honours_both_caps(w, h, want):
    got = pdf.max_dpi(w, h)
    assert got == want
    width, height = math.ceil(w * got / 72), math.ceil(h * got / 72)
    assert max(width, height) <= pdf.MAX_SIDE and width * height <= pdf.MAX_PIXELS
    assert pdf.effective_dpi(300, w, h) == min(300, want)


def _plan_rgb(path) -> np.ndarray:
    with rasterio.open(path) as p:
        return np.moveaxis(p.read([1, 2, 3]), 0, -1)


def test_strip_crop_lands_on_whole_rows():
    """pypdfium2 5.13 computes crop pixels as ceil(crop * scale); the 0.25 px bias must give the
    exact rows for every strip at every DPI."""
    for dpi in (72, 100, 150, 200, 300, 427):
        scale = dpi / 72
        height = math.ceil(842.0 * scale)
        for r0 in range(0, height, 97):
            r1 = min(height, r0 + 97)
            left, bottom, right, top = pdf.strip_crop(r0, r1, height, scale)
            assert (math.ceil(left * scale), math.ceil(right * scale)) == (0, 0)
            assert math.ceil(top * scale) == r0 and height - math.ceil(bottom * scale) == r1


def test_a_page_builds_at_its_dpi(client, project_id, wait_job, handle, tmp_path):
    insp = inspect_ready(
        client, project_id, wait_job, write_pdf(tmp_path / "set.pdf", [(300.0, 200.0), (842.0, 595.0)])
    )
    d = build_drawing(client, project_id, wait_job, insp["id"], page=2, dpi=100)
    assert (d["width"], d["height"], d["dpi"], d["page"]) == (
        math.ceil(842 * 100 / 72),
        math.ceil(595 * 100 / 72),
        100,
        2,
    )
    rgb = _plan_rgb(store.plan_path(handle, d["id"]))
    assert ((rgb[..., 0] > 200) & (rgb[..., 1] < 80)).any()  # the red fan
    assert ((rgb[..., 2] > 200) & (rgb[..., 0] < 80)).any()  # the blue disc


def test_strips_match_a_one_shot_render(tmp_path):
    """Plan Ruling 13: PDFium's anti-aliasing depends on the device origin, so not pixel-exact."""
    import pypdfium2 as pdfium

    src = write_pdf(tmp_path / "p.pdf", [(300.5, 200.3)])
    out = tmp_path / "plan.tif"
    width, height = pdf.render_page_to_plan(
        src, 1, 150, out, progress=lambda f, m="": None, check_cancelled=lambda: None, strip_rows=37
    )
    doc = pdfium.PdfDocument(str(src))
    try:
        page = doc[0]
        full = pdf.page_rgb(page.render(scale=150 / 72, rev_byteorder=True)).copy()
        page.close()
    finally:
        doc.close()
    strips = _plan_rgb(out)
    assert strips.shape == full.shape == (height, width, 3)
    diff = np.abs(strips.astype(int) - full.astype(int))
    assert diff.max() <= 4 and diff.mean() < 0.1


def test_a_rotated_page_renders_landscape(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(
        client, project_id, wait_job, write_pdf(tmp_path / "rot.pdf", [(600.0, 300.0)], rotate=90)
    )
    assert (insp["pages"][0]["width_pt"], insp["pages"][0]["height_pt"]) == (600.0, 300.0)
    d = build_drawing(client, project_id, wait_job, insp["id"], dpi=100)
    assert d["width"] > d["height"]


def test_peak_python_memory_stays_under_the_strip_bound(tmp_path, monkeypatch):
    """Plan Ruling 14: numpy allocations are traced; PDFium's own bitmap is not, so every render call
    is also checked to return at most STRIP_ROWS rows."""
    import pypdfium2 as pdfium

    src = write_pdf(tmp_path / "tall.pdf", [(600.0, 7200.0)])  # 1250 x 15000 px at 150 dpi
    heights = []
    real = pdfium.PdfPage.render

    def spy(self, *a, **kw):
        bitmap = real(self, *a, **kw)
        heights.append(bitmap.height)
        return bitmap

    monkeypatch.setattr(pdfium.PdfPage, "render", spy)
    tracemalloc.start()
    try:
        width, height = pdf.render_page_to_plan(
            src, 1, 150, tmp_path / "plan.tif", progress=lambda f, m="": None, check_cancelled=lambda: None
        )
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert (
        height == 15000
        and max(heights) <= pdf.STRIP_ROWS
        and len(heights) == math.ceil(15000 / pdf.STRIP_ROWS)
    )
    assert peak < 3 * 4 * pdf.STRIP_ROWS * width, peak


def test_the_dpi_is_lowered_to_the_pixel_cap(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "strip.pdf", [(14400.0, 1440.0)]))
    created = build_drawing(client, project_id, wait_job, insp["id"], dpi=300, wait=False)
    assert created["drawing"]["dpi"] == 100
    client.post(f"{BASE}/{project_id}/jobs/{created['job']['id']}/cancel")
    wait_job(project_id, created["job"]["id"])


def test_page_out_of_range(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "one.pdf", [(100.0, 100.0)]))
    body = {"inspection_id": insp["id"], "name": "P", "page": 2, "placement": {"method": "none"}}
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
