"""The brand on the PDF (spec 2026-10-02-asset-findings §10): cover band and logo, header logo,
footer website and confidentiality line, brand fonts, author."""

from dataclasses import replace

from PIL import Image
from report_docs import Snapshots, cover_section, document, standard_doc
from report_pdf_helpers import pdf_pages_text, pixel
from report_pdf_rules import brand

from app.reports.brand import ResolvedBrand
from app.reports.pdf import document as pdf_document


def _render(tmp_path, doc, b: ResolvedBrand | None, name="out"):
    return pdf_document.render_pdf(
        doc,
        tmp_path / name,
        "branded-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
        brand=b,
    )


def test_the_footer_carries_the_website_and_the_confidentiality_line(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    page2 = pdf_pages_text(part.path)[1]
    assert "www.example.com · page 2 / " in page2
    assert "For the recipient only." in page2
    assert "Kestrel AI ·" not in page2


def test_the_cover_band_is_the_brand_navy_with_the_logo_bottom_left(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    r, g, b = pixel(part.path, 0, 0.02, 0.02)
    assert r < 60 and g < 60 and b < 80  # navy, not Kestrel violet
    band_bottom = 0.38
    r, g, _ = pixel(part.path, 0, (18 + 5) / 210, band_bottom - (18 + 5) / 297)
    assert r > 150 and g < 120  # the red logo, flattened on navy


def test_the_header_logo_sits_left_of_the_title(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    r, g, _ = pixel(part.path, 1, (18 + 2) / 210, (10 - 1.5) / 297)
    assert r > 150 and g < 120


def test_brand_fonts_are_embedded_and_the_author_is_the_brands(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    raw = part.path.read_bytes()
    assert b"NunitoSans" in raw and b"Poppins" in raw
    assert b"/Author (Example Drones)" in raw


def test_no_brand_logo_leaves_the_band_and_header_plain(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path, logos=False))
    assert "www.example.com · page 2 / " in pdf_pages_text(part.path)[1]
    r, g, b = pixel(part.path, 0, (18 + 5) / 210, 0.38 - (18 + 5) / 297)
    assert r < 60 and g < 60 and b < 80  # the plain navy band, no red logo
    r, g, b = pixel(part.path, 1, (18 + 2) / 210, 6.5 / 297)  # inside the logo box, above the title text
    assert min(r, g, b) > 230  # paper, no red logo


def test_an_unbranded_render_is_unchanged(tmp_path):
    [part] = _render(tmp_path, standard_doc(), None)
    assert "Kestrel AI · Kuwait yard · page 2 / 5" in pdf_pages_text(part.path)[1]


def test_a_customer_logo_with_alpha_is_flattened(tmp_path):
    logo = tmp_path / "reports" / "assets" / "logo-cust.png"
    logo.parent.mkdir(parents=True)
    Image.new("RGBA", (200, 100), (20, 120, 200, 128)).save(logo)
    doc = document([cover_section(logo_path="reports/assets/logo-cust.png")])
    [part] = _render(tmp_path, doc, replace(brand(tmp_path), cover_logo=None))
    assert b"/SMask" not in part.path.read_bytes()
