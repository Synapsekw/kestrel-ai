"""The per-finding page (spec §7.3): heading band, main + secondary figures, kv, note, photos,
comments; one page per finding; the heading repeats as "(cont.)" when comments run over (the header
override is Task 12's document template; here the flowables and their overflow are tested)."""

from report_docs import Snapshots, context, document, finding, section
from report_pdf_helpers import pdf_pages_text
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreakIfNotEmpty, SimpleDocTemplate, Table

from app.reports.pdf import flowables


def _block(**kw):
    return document([section("finding_pages", "Finding pages", [finding(42, **kw)])]).sections[0].blocks[0]


def _pdf(tmp_path, story, name="f.pdf"):
    path = tmp_path / name
    m = 18 * mm
    SimpleDocTemplate(
        str(path), pagesize=A4, invariant=1, leftMargin=m, rightMargin=m, topMargin=m, bottomMargin=m
    ).build(story)
    return path


def test_finding_flowables_shape_and_markers(tmp_path):
    out = flowables.block_flowables(_block(), context(Snapshots(tmp_path)))
    assert isinstance(out[0], KeepTogether)
    assert isinstance(out[-2], flowables.FindingEnd) and isinstance(out[-1], PageBreakIfNotEmpty)
    band = out[0]._content[0]
    assert band._kestrel_finding == "F-0042 · Crack"
    assert band._kestrel_bookmark == ("f-fid-42", "F-0042 · Crack", 1)


def test_ungraded_finding_says_ungraded(tmp_path):
    out = flowables.block_flowables(_block(severity=False), context(Snapshots(tmp_path)))
    band = out[0]._content[0]
    assert band._cellvalues[0][1].label == "Ungraded"


def test_graded_finding_shows_its_severity_and_status(tmp_path):
    out = flowables.block_flowables(_block(), context(Snapshots(tmp_path)))
    cells = out[0]._content[0]._cellvalues[0]
    assert cells[1].label == "Major"
    assert "Open" in cells[2].text


def test_secondary_figures_pair_up_and_photos_run_four_per_row(tmp_path):
    out = flowables.block_flowables(
        _block(figs=("main", "a", "b", "c"), photos=5), context(Snapshots(tmp_path))
    )
    # Grid rows are one-row Tables; the band has 3 columns, the kv table has 3 rows.
    grids = [f for f in out[0]._content if isinstance(f, Table) and len(f._cellvalues) == 1]
    filled = {2: [], 4: []}
    for g in grids:
        cols = len(g._cellvalues[0])
        if cols in filled:
            filled[cols].append(sum(1 for c in g._cellvalues[0] if c != ""))
    # 3 secondary figures -> rows of 2 and 1; 5 photos -> rows of 4 and 1 (blank cells pad the rest).
    assert filled == {2: [2, 1], 4: [4, 1]}


def test_a_finding_prints_every_part(tmp_path):
    path = _pdf(tmp_path, flowables.block_flowables(_block(comments=2), context(Snapshots(tmp_path / "s"))))
    body = " ".join(pdf_pages_text(path))
    for needle in ("F-0042 · Crack", "Major", "DJI_0001.JPG", "Hairline crack.", "Photos", "Comment 1 on"):
        assert needle in body


def test_sixty_comments_and_a_very_long_note_continue_on_later_pages(tmp_path):
    note = " ".join(f"word{i}" for i in range(1500)) + " NOTE-END"
    block = _block(comments=60, note=note, photos=6)
    path = _pdf(tmp_path, flowables.block_flowables(block, context(Snapshots(tmp_path / "s"))))
    pages = pdf_pages_text(path)
    assert len(pages) > 2
    assert "F-0042 · Crack" in pages[0]  # the head band opens the first page, no blank page first
    body = " ".join(pages)
    assert "NOTE-END" in body and "Comment 59 on F-0042" in body


def test_a_long_unbroken_note_still_renders(tmp_path):
    block = _block(note="x" * 20000, comments=0, photos=0)
    path = _pdf(tmp_path, flowables.block_flowables(block, context(Snapshots(tmp_path / "s"))))
    assert "F-0042" in pdf_pages_text(path)[0]


def test_the_comments_label_and_each_meta_line_keep_with_the_next_line(tmp_path):
    out = flowables.block_flowables(_block(comments=3), context(Snapshots(tmp_path)))
    comments = out[1:-2]
    assert comments[0].text == "Comments" and comments[0].getKeepWithNext()
    metas, bodies = comments[1::2], comments[2::2]
    assert len(metas) == len(bodies) == 3
    assert all(m.getKeepWithNext() for m in metas)
    assert not any(b.getKeepWithNext() for b in bodies)
