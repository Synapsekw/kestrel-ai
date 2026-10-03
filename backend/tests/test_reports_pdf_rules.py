"""The PDF rules the inspection kit enforced (spec 2026-10-02-asset-findings §10, §12 acceptance 4):
no em or en dash in the text, zero /SMask, every font embedded, qpdf --check when qpdf is present,
and the output byte-identical twice."""

import shutil
import subprocess

import pytest
from PIL import Image
from report_docs import Snapshots, cover_section, document, section, summary_section
from report_pdf_rules import brand, dash_chars, font_names, smask_count, unembedded_fonts
from reports_asset_docs import MAP_BLOCK, asset_finding

from app.reports.pdf import document as pdf_document


def _doc(tmp_path):
    logo = tmp_path / "reports" / "assets" / "logo-cust.png"
    logo.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (200, 100), (20, 120, 200, 128)).save(logo)
    table = {
        "kind": "table",
        "columns": [{"key": "a", "label": "Data item"}, {"key": "b", "label": "Period"}],
        "rows": [["—", "1 Sep 2026 – 3 Sep 2026"]],
    }
    return document(
        [
            cover_section(logo_path="reports/assets/logo-cust.png"),
            summary_section(),
            section("asset_summary", "Asset summary", [MAP_BLOCK]),
            section("findings_table", "Findings — all", [table]),
            section(
                "finding_pages",
                "Finding pages",
                [asset_finding(7, "Crack — wide – long"), asset_finding(8)],
            ),
        ]
    )


def _render(tmp_path, name):
    [part] = pdf_document.render_pdf(
        _doc(tmp_path),
        tmp_path / name,
        "rules-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
        brand=brand(tmp_path),
    )
    return part


@pytest.fixture
def pdf(tmp_path):
    return _render(tmp_path, "out")


def test_no_em_or_en_dash_in_the_text(pdf):
    assert dash_chars(pdf.path) == []


def test_zero_soft_masks(pdf):
    assert smask_count(pdf.path) == 0


def test_every_font_is_embedded(pdf):
    raw = pdf.path.read_bytes()
    assert font_names(pdf.path) and not unembedded_fonts(pdf.path), unembedded_fonts(pdf.path)
    assert raw.count(b"/FontFile2") >= len(font_names(pdf.path))


def test_qpdf_check_passes(pdf):
    qpdf = shutil.which("qpdf")
    if qpdf is None:
        pytest.skip("qpdf is not on PATH")
    run = subprocess.run([qpdf, "--check", str(pdf.path)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr


def test_a_branded_render_is_byte_identical_twice(tmp_path, pdf):
    again = _render(tmp_path, "again")
    assert again.sha256 == pdf.sha256
