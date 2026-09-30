"""The numbered canvas (spec §10.1 page furniture, §10.3 determinism, §10.4 continuous numbering)."""

import hashlib
from datetime import UTC, datetime

from report_pdf_helpers import pdf_pages_text
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph

from app.reports.pdf import canvas, fonts, styles

AT = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


def _build(path, meta, pages=3):
    st = styles.build_styles(fonts.register_fonts())
    doc = BaseDocTemplate(str(path), pagesize=A4, invariant=1, initialFontName=st.fonts.sans)
    doc.addPageTemplates([PageTemplate("body", [Frame(18 * mm, 18 * mm, A4[0] - 36 * mm, A4[1] - 36 * mm)])])
    story = []
    for i in range(pages):
        story += [Paragraph(f"Body {i + 1}", st.body), PageBreak()]
    doc.build(story[:-1], canvasmaker=canvas.canvas_class(meta, st))
    return meta


def _meta(**kw):
    return canvas.PageMeta(
        title="Site report", version_label="v3", project="Kuwait yard", generated_at=AT, **kw
    )


def test_footer_and_header_on_every_page(tmp_path):
    meta = _build(tmp_path / "a.pdf", _meta())
    text = pdf_pages_text(tmp_path / "a.pdf")
    assert meta.page_count == 3 and len(text) == 3
    for n, page in enumerate(text, start=1):
        assert f"Kestrel AI · Kuwait yard · page {n} / 3" in page
        assert "Site report" in page and "v3" in page


def test_offset_and_total_continue_numbering_across_parts(tmp_path):
    _build(tmp_path / "p2.pdf", _meta(page_offset=211, total_pages=530))
    text = pdf_pages_text(tmp_path / "p2.pdf")
    assert "page 212 / 530" in text[0] and "page 214 / 530" in text[2]


def test_cover_pages_have_no_furniture_and_overrides_replace_the_header(tmp_path):
    meta = _meta(cover_pages=frozenset({1}))
    meta.header_overrides[3] = "F-0042 · Crack (cont.)"
    _build(tmp_path / "c.pdf", meta)
    text = pdf_pages_text(tmp_path / "c.pdf")
    assert "Kestrel AI" not in text[0]
    assert "F-0042 · Crack (cont.)" in text[2] and "Site report" not in text[2]
    assert "page 2 / 3" in text[1]


def test_creation_date_is_generated_at_and_output_is_byte_stable(tmp_path):
    _build(tmp_path / "x.pdf", _meta())
    _build(tmp_path / "y.pdf", _meta())
    x, y = (tmp_path / "x.pdf").read_bytes(), (tmp_path / "y.pdf").read_bytes()
    assert b"/CreationDate (D:20260930120000+00'00')" in x
    assert hashlib.sha256(x).digest() == hashlib.sha256(y).digest()


def test_pdf_date_is_utc():
    from datetime import timedelta, timezone

    local = datetime(2026, 9, 30, 15, 0, tzinfo=timezone(timedelta(hours=3)))
    assert canvas.pdf_date(local) == "D:20260930120000+00'00'"
