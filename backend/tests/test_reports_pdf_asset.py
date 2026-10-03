"""The asset blocks in the PDF (spec 2026-10-02-asset-findings §10) and the kit's text rules: no em or
en dash in the page text, every font an embedded subset."""

from report_docs import Snapshots, document, section, standard_doc
from report_pdf_helpers import pdf_pages_text
from report_pdf_rules import dash_chars, font_names, unembedded_fonts
from reports_asset_docs import MAP_BLOCK, asset_finding

from app.reports.pdf import active
from app.reports.pdf import document as pdf_document
from app.reports.pdf.flowables_text import text, undash
from app.reports.theme import THEME


def _render(tmp_path, doc, name="out"):
    return pdf_document.render_pdf(
        doc,
        tmp_path / name,
        "asset-report-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
    )


def test_undash_follows_the_kit():
    assert undash("\u2014") == "-" and undash(" \u2013 ") == "-"
    assert undash("1 Sep 2026 \u2013 3 Sep 2026") == "1 Sep 2026 to 3 Sep 2026"
    assert undash("Per survey \u2014 counts") == "Per survey, counts"
    assert undash("a\u2014b") == "a, b" and undash("x\u2013y") == "x-y"
    assert undash("Crack \u00b7 F-0001") == "Crack \u00b7 F-0001"


def test_text_undashes_before_escaping():
    assert text("a \u2014 <b>") == "a, &lt;b&gt;"


def test_an_asset_map_prints_as_vectors_with_its_labels(tmp_path):
    [part] = _render(tmp_path, document([section("asset_summary", "Asset summary", [MAP_BLOCK])]))
    page = pdf_pages_text(part.path)[0]
    for label in ("Tower A", "Upper floors", "Side of the asset", "60 m", MAP_BLOCK["caption"]):
        assert label in page, label
    assert b"/Subtype /Image" not in part.path.read_bytes()  # vector, no raster


def test_an_asset_finding_prints_its_kicker_and_facts_beside_the_height_locator(tmp_path):
    [part] = _render(tmp_path, document([section("finding_pages", "Finding pages", [asset_finding()])]))
    page = pdf_pages_text(part.path)[0]
    assert "Finding F-0007 \u00b7 Upper floors \u00b7 seen in 2 photos" in page
    assert "41.2 m above street level" in page and "41.2 m" in page


def test_no_em_or_en_dash_reaches_the_page_text(tmp_path):
    table = {
        "kind": "table",
        "columns": [{"key": "a", "label": "Data item"}, {"key": "b", "label": "Period"}],
        "rows": [["\u2014", "1 Sep 2026 \u2013 3 Sep 2026"]],
    }
    doc = document(
        [
            section("findings_table", "Findings \u2014 all", [table]),
            section("finding_pages", "Finding pages", [asset_finding(note="Crack \u2014 wide \u2013 long")]),
        ]
    )
    [part] = _render(tmp_path, doc)
    joined = "".join(pdf_pages_text(part.path))
    assert not dash_chars(part.path)
    assert "1 Sep 2026 to 3 Sep 2026" in joined and "Crack, wide to long" in joined


def test_every_font_is_an_embedded_subset(tmp_path):
    [part] = _render(tmp_path, standard_doc())  # tables, a chart, KPIs, findings
    assert font_names(part.path) and not unembedded_fonts(part.path), unembedded_fonts(part.path)


def test_the_theme_is_restored_after_a_render(tmp_path):
    _render(tmp_path, standard_doc())
    assert active.theme() is THEME
