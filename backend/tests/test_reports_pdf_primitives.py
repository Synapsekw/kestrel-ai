"""Figures embed the cached JPEG as DCT passthrough; anything unreadable becomes a placeholder with its
reason (spec §9.5 "Failure", §16); severity is a dot plus ink text (§10.1)."""

from report_pdf_helpers import jpeg, pdf_pages_text, pixel
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, SimpleDocTemplate, Table

from app.reports.pdf import fonts, primitives, styles
from app.reports.pdf.flowables_text import text

ST = styles.build_styles(fonts.register_fonts())


def _pdf(tmp_path, flowables, name="p.pdf"):
    path = tmp_path / name
    SimpleDocTemplate(str(path), pagesize=A4, invariant=1).build(flowables)
    return path


def test_fit_box_keeps_the_aspect_inside_the_box():
    assert primitives.fit_box(1200, 900, 170, 105) == (140.0, 105.0)
    assert primitives.fit_box(900, 100, 90, 90) == (90.0, 10.0)


def test_a_jpeg_figure_is_passed_through_and_captioned(tmp_path):
    src = jpeg(tmp_path / "s.jpg", 1200, 900, (200, 40, 40))
    path = _pdf(tmp_path, [primitives.figure_flowable(src, 170 * mm, 105 * mm, "North face", ST)])
    data = path.read_bytes()
    assert data.count(b"/DCTDecode") == 1
    assert "North face" in pdf_pages_text(path)[0]
    r, g, b = pixel(path, 0, 0.5, 0.2)
    assert r > 150 and g < 90


def test_missing_and_unreadable_snapshots_become_placeholders(tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"\xff\xd8 truncated")
    flows = [
        primitives.figure_flowable(None, 80 * mm, 50 * mm, "", ST, reason="Source image moved"),
        primitives.figure_flowable(tmp_path / "gone.jpg", 80 * mm, 50 * mm, "", ST),
        primitives.figure_flowable(bad, 80 * mm, 50 * mm, "", ST),
    ]
    path = _pdf(tmp_path, flows)
    text_out = pdf_pages_text(path)[0]
    assert "Source image moved" in text_out and "Snapshot unavailable" in text_out
    assert "Snapshot unreadable" in text_out
    assert b"/DCTDecode" not in path.read_bytes()


def test_severity_tag_prints_its_word_and_survives_a_bad_colour(tmp_path):
    tags = [
        primitives.SeverityTag("Major", "#F59E0B", ST),
        primitives.SeverityTag("Ungraded", None, ST),
        primitives.SeverityTag("Odd", "yellow", ST),
    ]
    w, h = tags[0].wrap(500, 500)
    assert w > 20 and h > 8
    text_out = pdf_pages_text(_pdf(tmp_path, tags))[0]
    assert "Major" in text_out and "Ungraded" in text_out and "Odd" in text_out


def test_figure_flowable_is_atomic_and_survives_inside_a_table_cell(tmp_path):
    """Controller ruling P1: figure_flowable must be atomic (not a KeepTogether), since Tasks 10/11
    place it inside Table cells and a KeepTogether inside a Table cell raises LayoutError on
    reportlab 5.0.1."""
    src = jpeg(tmp_path / "s.jpg", 400, 300)
    fig = primitives.figure_flowable(src, 80 * mm, 50 * mm, "Inside a cell", ST)
    assert not isinstance(fig, KeepTogether)
    table = Table([[fig]], colWidths=[90 * mm])
    path = _pdf(tmp_path, [table])
    assert "Inside a cell" in pdf_pages_text(path)[0]


def test_text_escapes_drops_controls_keeps_newlines_and_cuts():
    assert text("<b> & \x07ok\nnext") == "&lt;b&gt; &amp; ok<br/>next"
    assert text(None) == ""
    assert text("x" * 10, limit=5) == "xxxx…"
