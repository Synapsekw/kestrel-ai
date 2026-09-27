"""PDF drawings (spec §8.2 PDF, §13 memory, §14 PDF errors; plan Tasks 4 and 6)."""

import io
import math
import sys

import pytest
from drawings_helpers import BASE, inspect_ready, write_pdf, write_png
from PIL import Image

from app.drawings import pdf


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
    from app.drawings import store

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
