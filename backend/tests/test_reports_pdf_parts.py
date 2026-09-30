"""Parts (spec §10.4): split at finding boundaries above PART_BUDGET, part 1 carries cover, summary and
table, page numbering continues across parts, each part bookmarks its sections."""

import pytest
from report_docs import (
    Snapshots,
    cover_section,
    document,
    finding,
    section,
    standard_doc,
    summary_section,
    table_section,
)
from report_pdf_helpers import pdf_page_count, pdf_pages_text, pdf_toc

from app.jobs.cancellation import JobCancelled
from app.reports.pdf import document as pdf_document
from app.reports.pdf.document import Slice


def _render(tmp_path, doc, budget, check_cancelled=lambda: None, snaps_root=None):
    snaps = Snapshots(snaps_root or tmp_path / "snaps")
    seen = []
    parts = pdf_document.render_pdf(
        doc,
        tmp_path / "out",
        "site-report-v001",
        snapshot_path=snaps,
        volume_flowables=None,
        progress=seen.append,
        check_cancelled=check_cancelled,
        part_budget=budget,
    )
    return parts, seen, snaps


def _one_finding_bytes(tmp_path):
    snaps = Snapshots(tmp_path / "probe")
    block = document([section("finding_pages", "F", [finding(1)])]).sections[0].blocks[0]
    return sum(snaps(r).stat().st_size for r in pdf_document.snapshot_refs(block))


def test_default_budget_is_160_mb_and_one_file(tmp_path):
    assert pdf_document.PART_BUDGET == 160 * 1024 * 1024
    snaps = Snapshots(tmp_path / "snaps")
    seen = []
    parts = pdf_document.render_pdf(
        standard_doc(n_findings=3),
        tmp_path / "out",
        "site-report-v001",
        snapshot_path=snaps,
        volume_flowables=None,
        progress=seen.append,
        check_cancelled=lambda: None,
    )
    assert [p.name for p in parts] == ["site-report-v001.pdf"]
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == ["site-report-v001.pdf"]
    assert seen == sorted(seen) and seen[-1] == 1.0 and seen.count(1.0) == 1


def test_a_lowered_budget_splits_at_findings_with_continuous_numbering(tmp_path):
    per = _one_finding_bytes(tmp_path)
    parts, seen, _ = _render(tmp_path, standard_doc(n_findings=3), int(per * 1.5))
    assert [p.name for p in parts] == [f"site-report-v001-part{k}-of-3.pdf" for k in (1, 2, 3)]
    total = sum(p.pages for p in parts)
    assert [p.pages for p in parts] == [pdf_page_count(p.path) for p in parts]
    first = pdf_pages_text(parts[0].path)
    assert "Quarterly inspection" in first[0]
    assert any("Summary" in p for p in first) and any("F-0001" in p for p in first)
    p2 = pdf_pages_text(parts[1].path)
    assert f"page {parts[0].pages + 1} / {total}" in p2[0] and "F-0002" in p2[0]
    last = pdf_pages_text(parts[2].path)
    assert f"page {total} / {total}" in last[-1]
    assert pdf_toc(parts[1].path) == [(0, "Finding pages (cont.)"), (1, "F-0002 · Spalling")]
    assert seen == sorted(seen) and all(0.0 <= v <= 1.0 for v in seen)
    assert seen[-1] == 1.0 and seen.count(1.0) == 1


def test_parts_are_deterministic(tmp_path):
    per = _one_finding_bytes(tmp_path)
    # Same inputs means the same snapshot files (reportlab names an image XObject by the digest of its
    # filename, so the cache path is an input); only the output directory differs.
    shared = tmp_path / "snaps"
    a, _, _ = _render(tmp_path / "a", standard_doc(n_findings=3), int(per * 1.5), snaps_root=shared)
    b, _, _ = _render(tmp_path / "b", standard_doc(n_findings=3), int(per * 1.5), snaps_root=shared)
    assert len(a) == 3
    assert [p.sha256 for p in a] == [p.sha256 for p in b]


def test_a_figure_larger_than_the_budget_gets_a_part_of_its_own(tmp_path):
    doc = standard_doc(n_findings=3)
    parts, seen, _ = _render(tmp_path, doc, 1)
    # cover; summary+table (0 bytes, together); then each finding alone: no empty part, it terminates
    assert [p.name for p in parts] == [f"site-report-v001-part{k}-of-5.pdf" for k in range(1, 6)]
    assert all(p.pages >= 1 for p in parts)
    assert seen[-1] == 1.0


def test_cancel_between_parts_propagates(tmp_path, monkeypatch):
    """JobCancelled raised by the between-parts check propagates: nothing is returned as output."""
    per = _one_finding_bytes(tmp_path)
    calls = []
    real_build = pdf_document._build

    def check():
        calls.append(len(list((tmp_path / "out").glob("*.pdf"))) if (tmp_path / "out").exists() else 0)
        if calls[-1] >= 1:
            raise JobCancelled()

    def build(*args, **kwargs):
        kwargs["check_cancelled"] = lambda: None  # only the between-parts check may cancel here
        return real_build(*args, **kwargs)

    monkeypatch.setattr(pdf_document, "_build", build)
    with pytest.raises(JobCancelled):
        _render(tmp_path, standard_doc(n_findings=3), int(per * 1.5), check_cancelled=check)
    assert sorted(p.name for p in (tmp_path / "out").glob("*.pdf")) == ["site-report-v001-part1-of-3.pdf"]


def test_plan_parts_keeps_small_sections_together_and_isolates_a_giant_block():
    doc = document(
        [
            cover_section(),
            summary_section(),
            table_section(),
            section("finding_pages", "F", [finding(1), finding(2), finding(3)]),
        ]
    )
    sizes = {"finding": 100}

    def size_of(block):
        return 1000 if block.kind == "finding" and block.number == 2 else sizes.get(block.kind, 0)

    parts = pdf_document.plan_parts(doc, size_of, 150)
    assert parts == [
        [Slice(0, 0, 1), Slice(1, 0, 3), Slice(2, 0, 2), Slice(3, 0, 1)],
        [Slice(3, 1, 2)],
        [Slice(3, 2, 3)],
    ]
    assert all(parts)


def test_plan_parts_never_splits_the_cover_and_keeps_empty_sections():
    extra = {"kind": "para", "text": "Prepared for the client.", "style": "small"}
    cover = cover_section()
    cover["blocks"].append(extra)
    doc = document([cover, section("appendix", "Appendix", [])])
    assert pdf_document.plan_parts(doc, lambda b: 10**9, 1) == [[Slice(0, 0, 2)], [Slice(1, 0, 0)]]
