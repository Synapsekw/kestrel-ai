"""render_pdf end to end (spec §10, §16, §17 PDF): sha256 stable twice (and in a second process), page
count, bookmarks, cover, one page per finding, "(cont.)", progress, cancel, the volume hook, the fixed
creation date, the paper size and the Helvetica fallback."""

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest
from report_docs import (
    Snapshots,
    cover_section,
    document,
    finding,
    key,
    section,
    standard_doc,
    summary_section,
)
from report_pdf_helpers import pdf_pages_text, pdf_toc, pixel

from app.jobs.cancellation import JobCancelled
from app.reports.pdf import document as pdf_document
from app.reports.pdf import fonts

BACKEND = Path(__file__).resolve().parents[1]


def _render(tmp_path, doc, name="out", **kw):
    snaps = kw.pop("snaps", None) or Snapshots(tmp_path / "snaps")
    seen = kw.pop("seen", [])
    return pdf_document.render_pdf(
        doc,
        tmp_path / name,
        "kuwait-report-v003",
        snapshot_path=snaps,
        volume_flowables=kw.pop("volume_flowables", None),
        progress=seen.append,
        check_cancelled=kw.pop("check_cancelled", lambda: None),
        **kw,
    )


def _page_sizes(path: Path) -> list[tuple[float, float]]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        return [tuple(round(v, 1) for v in pdf[i].get_size()) for i in range(len(pdf))]
    finally:
        pdf.close()


def test_one_part_named_after_base_name_with_its_facts(tmp_path):
    [part] = _render(tmp_path, standard_doc())
    assert part.name == "kuwait-report-v003.pdf" and part.path == tmp_path / "out" / part.name
    assert part.bytes == part.path.stat().st_size
    assert part.sha256 == hashlib.sha256(part.path.read_bytes()).hexdigest()
    # cover, summary, findings table, 2 finding pages
    assert part.pages == 5 == len(pdf_pages_text(part.path))


def test_sha256_is_stable_twice_and_across_processes(tmp_path):
    a = _render(tmp_path, standard_doc(), "a")[0]
    b = _render(tmp_path, standard_doc(), "b")[0]
    assert a.sha256 == b.sha256
    # Same inputs means the same snapshot files: reportlab names an image XObject by the digest of its
    # filename, so the snapshot cache path is an input. The output directory is not (a, b, c differ).
    script = (
        "import sys; sys.path.insert(0, 'tests');"
        "from pathlib import Path; from report_docs import Snapshots, standard_doc;"
        "from app.reports.pdf.document import render_pdf;"
        f"p = render_pdf(standard_doc(), Path(r'{tmp_path / 'c'}'), 'kuwait-report-v003',"
        f" snapshot_path=Snapshots(Path(r'{tmp_path / 'snaps'}')), volume_flowables=None,"
        " progress=lambda f: None, check_cancelled=lambda: None)[0]; print(p.sha256)"
    )
    out = subprocess.run(
        [sys.executable, "-c", script], cwd=BACKEND, capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == a.sha256


def test_creation_date_is_generated_at(tmp_path):
    [part] = _render(tmp_path, standard_doc())
    assert b"/CreationDate (D:20260930120000+00'00')" in part.path.read_bytes()


def test_bookmarks_per_section_and_per_finding(tmp_path):
    [part] = _render(tmp_path, standard_doc())
    assert pdf_toc(part.path) == [
        (0, "Cover"),
        (0, "Summary"),
        (0, "Findings"),
        (0, "Finding pages"),
        (1, "F-0001 · Crack"),
        (1, "F-0002 · Spalling"),
    ]


def test_cover_band_title_rows_locator_logo_and_furniture(tmp_path):
    from report_pdf_helpers import jpeg

    # R2 stores the logo project-relative; out_dir (tmp_path/out) lies inside the "project" tmp_path.
    jpeg(tmp_path / "reports" / "assets" / "logo-abcd1234.jpg", 200, 100, (200, 30, 30))
    [part] = _render(tmp_path, standard_doc(logo_path="reports/assets/logo-abcd1234.jpg"))
    pages = pdf_pages_text(part.path)
    assert "Quarterly inspection" in pages[0] and "North yard" in pages[0] and "Kestrel AI" not in pages[0]
    assert "D. Jovanovic" in pages[0] and "Site locator" in pages[0]
    assert b"/ShadingType 2" in part.path.read_bytes()
    assert pixel(part.path, 0, 0.02, 0.02)[2] > 100  # the band's violet, not white paper
    r, g, _ = pixel(part.path, 0, 1 - (18 + 22) / 210, (18 + 11) / 297)
    assert r > 150 and g < 90  # the logo on its chip, top right
    assert "Kestrel AI · Kuwait yard · page 2 / 5" in pages[1]
    assert "Quarterly inspection" in pages[1] and "v3" in pages[1]  # header: title and version


def test_a_missing_logo_file_is_skipped(tmp_path):
    [part] = _render(tmp_path, standard_doc(logo_path="reports/assets/gone.png"))
    assert "Quarterly inspection" in pdf_pages_text(part.path)[0]


def test_cover_logo_resolves_absolute_and_project_relative_paths(tmp_path):
    from report_pdf_helpers import jpeg

    logo = jpeg(tmp_path / "proj" / "reports" / "assets" / "l.jpg")
    out_dir = tmp_path / "proj" / "reports" / "r1" / "v001-partial"
    rel = document([cover_section("reports/assets/l.jpg")]).sections[0]
    absolute = document([cover_section(str(logo))]).sections[0]
    gone = document([cover_section("reports/assets/gone.jpg")]).sections[0]
    none = document([cover_section(None)]).sections[0]
    assert pdf_document.cover_logo(rel, out_dir) == logo
    assert pdf_document.cover_logo(absolute, out_dir) == logo
    assert pdf_document.cover_logo(gone, out_dir) is None
    assert pdf_document.cover_logo(none, out_dir) is None


def test_one_page_per_finding(tmp_path):
    [part] = _render(tmp_path, standard_doc(n_findings=3))
    pages = pdf_pages_text(part.path)
    for n in (1, 2, 3):
        assert sum(f"F-000{n} ·" in p for p in pages) == 1


def test_a_finding_with_many_comments_continues_with_a_cont_header(tmp_path):
    doc = document([section("finding_pages", "Finding pages", [finding(1, comments=60), finding(2)])])
    [part] = _render(tmp_path, doc)
    pages = pdf_pages_text(part.path)
    assert "F-0001 · Crack (cont.)" in pages[1]
    assert not any("F-0002 · Crack (cont.)" in p or "F-0002 · Spalling (cont.)" in p for p in pages)


def test_progress_is_monotonic_and_ends_at_one(tmp_path):
    seen = []
    _render(tmp_path, standard_doc(), seen=seen)
    assert len(seen) > 5 and seen == sorted(seen) and seen[-1] == 1.0 and 0 <= seen[0]
    assert all(0 <= f <= 1.0 for f in seen)


def test_progress_does_not_reach_one_before_the_end(tmp_path):
    """P6: the total counts KeepTogether contents, so the finding pages do not saturate the bar early."""
    seen, calls = [], []
    _render(tmp_path, standard_doc(n_findings=6), seen=seen, check_cancelled=lambda: calls.append(1))
    assert seen.count(1.0) == 1 and seen[-2] < 1.0
    # progress is reported only when it rises: a total that counted each KeepTogether as one flowable
    # saturated about halfway through the flowables (measured: 56 rises for 125 flowables); the
    # recursive count keeps rising for nearly all of them (115 for 125).
    assert len(seen) - 1 >= 0.8 * (len(calls) - 1)


def test_count_flowables_counts_keep_together_contents():
    from reportlab.platypus import KeepTogether, PageBreak, Spacer

    story = [
        Spacer(1, 1),
        KeepTogether([Spacer(1, 1), KeepTogether([Spacer(1, 1), Spacer(1, 1)])]),
        PageBreak(),
    ]
    assert pdf_document.count_flowables(story) == 5


def test_cancel_mid_render_raises_and_writes_nothing(tmp_path):
    calls = []

    def check():
        calls.append(1)
        if len(calls) > 6:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        _render(tmp_path, standard_doc(), check_cancelled=check)
    assert not list((tmp_path / "out").glob("*.pdf"))


def test_the_size_estimate_never_swallows_a_cancel(tmp_path):
    doc = standard_doc()

    def snaps(ref):
        raise JobCancelled()

    with pytest.raises(JobCancelled):
        pdf_document._estimate(doc.sections[-1].blocks[0], snaps, {})


def test_the_volume_hook_renders_volume_blocks(tmp_path):
    from reportlab.platypus import Paragraph

    vol = {"kind": "volume", "measurement_id": "m1", "title": "Stockpile A", "rows": [], "stale": False}
    doc = document([section("measurements", "Measurements", [vol])])
    [part] = _render(
        tmp_path, doc, volume_flowables=lambda b: [Paragraph(f"VOLUME PAGES {b.measurement_id}")]
    )
    assert "VOLUME PAGES m1" in pdf_pages_text(part.path)[0]


def test_a_failing_volume_hook_falls_back_to_the_table_form(tmp_path, caplog):
    def hook(block):
        raise RuntimeError("volume pages broke")

    vol = {
        "kind": "volume",
        "measurement_id": "m1",
        "title": "Stockpile A",
        "rows": [["Volume", "1 234 m³"]],
        "stale": False,
    }
    doc = document([section("measurements", "Measurements", [vol])])
    [part] = _render(tmp_path, doc, volume_flowables=hook)
    page = pdf_pages_text(part.path)[0]
    assert "Stockpile A" in page and "1 234 m³" in page
    assert "volume pages broke" in caplog.text


def test_missing_snapshots_and_an_empty_section_still_render(tmp_path):
    doc = document(
        [
            cover_section(),
            section("appendix", "Appendix", []),
            section("finding_pages", "Finding pages", [finding(1)]),
        ]
    )
    [part] = _render(tmp_path, doc, snaps=Snapshots(tmp_path / "s", missing=frozenset({key("f1-main")})))
    assert any("Snapshot unavailable" in p for p in pdf_pages_text(part.path))


def test_a_document_without_sections_is_one_readable_no_content_page(tmp_path):
    seen = []
    [part] = _render(tmp_path, document([]), seen=seen)
    pages = pdf_pages_text(part.path)
    assert part.pages == len(pages) == 1 and "No content" in pages[0]
    assert seen[-1] == 1.0


def test_a_document_with_only_an_empty_section_still_opens(tmp_path):
    [part] = _render(tmp_path, document([section("appendix", "Appendix", [])]))
    assert part.pages == len(pdf_pages_text(part.path)) >= 1
    assert pdf_toc(part.path) == [(0, "Appendix")]


def test_a_cover_only_document_is_one_bookmarked_page(tmp_path):
    seen = []
    [part] = _render(tmp_path, document([cover_section()]), seen=seen)
    pages = pdf_pages_text(part.path)
    assert part.pages == len(pages) == 1 and "Quarterly inspection" in pages[0]
    assert pdf_toc(part.path) == [(0, "Cover")]
    assert seen[-1] == 1.0


def test_helvetica_fallback_when_the_fonts_are_removed(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(fonts, "FONT_DIR", tmp_path / "no-fonts")
    monkeypatch.setattr(fonts, "_cache", {})
    [part] = _render(tmp_path, standard_doc())
    data = part.path.read_bytes()
    assert b"SpaceGrotesk" not in data and b"/Helvetica" in data
    assert "Helvetica" in caplog.text
    assert "Quarterly inspection" in pdf_pages_text(part.path)[0]


def test_a4_is_the_default_and_letter_documents_print_on_letter(tmp_path):
    [a4] = _render(tmp_path, standard_doc(), "a4")
    letter_doc = document([cover_section(), summary_section()], paper="Letter")
    [letter] = _render(tmp_path, letter_doc, "letter")
    assert set(_page_sizes(a4.path)) == {(595.3, 841.9)}
    assert set(_page_sizes(letter.path)) == {(612.0, 792.0)}
    assert pdf_document.doc_meta(letter_doc).paper == "Letter"


def test_doc_meta_title_project_version_and_paper():
    doc = standard_doc()
    meta = pdf_document.doc_meta(doc)
    assert (meta.title, meta.project, meta.version_label, meta.paper) == (
        "Quarterly inspection",
        "Kuwait yard",
        "v3",
        "A4",
    )
    assert meta.generated_at == doc.generated_at
    assert (
        pdf_document.doc_meta(document([section("summary", "Summary", [])], version=None)).version_label
        == "Draft"
    )
    assert pdf_document.doc_meta(document([section("summary", "Summary", [])])).title == "Summary"


def test_an_overflowing_cover_continues_on_a_white_body_page(tmp_path):
    """Final review I1: rows that do not fit below the band go on to a body page, not a second band."""
    cover = cover_section()
    cover["blocks"][0]["rows"] += [[f"Row {i}", f"value {i}"] for i in range(60)]
    [part] = _render(tmp_path, document([cover, summary_section()]))
    pages = pdf_pages_text(part.path)
    assert "Row 59" in pages[1] and "Row 59" not in pages[0]
    assert all(v > 240 for v in pixel(part.path, 1, 0.5, 0.005))  # white paper, not the violet band
    assert "Kestrel AI · Kuwait yard · page 2 /" in pages[1]  # a body page carries the furniture


def test_a_5000_character_caption_is_capped_on_every_kind_of_figure(tmp_path):
    """Final review I2: a body figure, a finding's main figure and a photo, and the cover locator."""
    from report_docs import figure

    long = "caption " * 625  # 5000 characters
    cover = cover_section()
    cover["blocks"][0]["locator"]["caption"] = long
    f = finding(1)
    f["figures"][0]["caption"] = long
    f["photos"][0]["caption"] = long
    body = section("appendix", "Figures", [figure("fig", caption=long)])
    doc = document([cover, body, section("finding_pages", "Finding pages", [f])])
    [part] = _render(tmp_path, doc)
    text = "\n".join(pdf_pages_text(part.path))
    assert "…" in text and "F-0001 · Crack" in text


def test_an_empty_section_prints_no_content(tmp_path):
    doc = document([summary_section(), section("appendix", "Appendix", [])])
    [part] = _render(tmp_path, doc)
    pages = pdf_pages_text(part.path)
    assert len(pages) == 2 and "No content" in pages[1] and "No content" not in pages[0]


def test_cover_logo_rejects_a_relative_path_that_climbs_out(tmp_path, caplog):
    from report_pdf_helpers import jpeg

    jpeg(tmp_path / "outside.jpg")
    out_dir = tmp_path / "proj" / "reports" / "r1"
    climbing = document([cover_section("../outside.jpg")]).sections[0]
    assert pdf_document.cover_logo(climbing, out_dir) is None
    assert "outside.jpg" in caplog.text
