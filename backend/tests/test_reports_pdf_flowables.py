"""Every block kind renders (spec §10.2), hostile text prints literally (§8.1), and nothing raises on
missing snapshots, empty blocks or oversized tables (§16)."""

import logging

import pytest
from report_docs import Snapshots, context, document, figure, key, section
from report_pdf_helpers import pdf_pages_text
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table

from app.jobs.cancellation import JobCancelled
from app.reports.pdf import flowables


def _blocks(*blocks):
    return document([section("summary", "S", list(blocks))]).sections[0].blocks


def _pdf(tmp_path, ctx, blocks, name="f.pdf"):
    story = [f for b in blocks for f in flowables.block_flowables(b, ctx)]
    path = tmp_path / name
    SimpleDocTemplate(str(path), pagesize=A4, invariant=1, leftMargin=18 * mm, rightMargin=18 * mm).build(
        story
    )
    return path


@pytest.fixture
def ctx(tmp_path):
    return context(Snapshots(tmp_path / "snaps"))


def test_heading_para_kv_kpis_table_chart_and_figures_all_print(tmp_path, ctx):
    blocks = _blocks(
        {"kind": "heading", "level": 2, "text": "Overview"},
        {"kind": "para", "text": "First paragraph.\n\nSecond <b>&</b> one.", "style": "note"},
        {"kind": "kv", "rows": [["Site", "North yard"]]},
        {"kind": "kpis", "items": [{"label": "Total", "value": "12", "delta": "+2", "tone": "bad"}]},
        {
            "kind": "table",
            "repeat_header": True,
            "columns": [{"key": "a", "label": "Alpha", "align": "left"}, {"key": "s", "label": "Sev"}],
            "rows": [["one", "x"], ["two", {"text": "Major", "dot": "#F59E0B"}]],
        },
        {
            "kind": "chart",
            "chart": "line",
            "title": "Open over time",
            "series": [{"name": "Open", "values": [1, 2]}],
            "x_labels": ["Jan", "Feb"],
            "unit": "count",
        },
        figure("fig-1", caption="West wall"),
        {"kind": "figure_row", "figures": [figure("r1", "Left", 83, 52), figure("r2", "Right", 83, 52)]},
        {"kind": "page_break"},
    )
    text = "\n".join(pdf_pages_text(_pdf(tmp_path, ctx, blocks)))
    for word in (
        "Overview",
        "First paragraph.",
        "Second <b>&</b> one.",
        "North yard",
        "Total",
        "+2",
        "Alpha",
        "two",
        "Major",
        "Open over time",
        "Jan",
        "count",
        "West wall",
        "Left",
        "Right",
    ):
        assert word in text, word
    assert "dot=" not in text and "#F59E0B" not in text  # a dot cell is a dot and text, not its repr


def test_table_columns_honour_style_and_align(ctx):
    block = _blocks(
        {
            "kind": "table",
            "columns": [
                {"key": "n", "label": "No.", "align": "right", "style": "mono"},
                {"key": "c", "label": "Mid", "align": "center"},
                {"key": "t", "label": "Type"},
            ],
            "rows": [["F-0001", "3", "Crack"]],
        }
    )[0]
    table = next(f for f in flowables.block_flowables(block, ctx) if isinstance(f, Table))
    mono, mid, plain = table._cellvalues[1]
    assert mono.style.fontName == ctx.styles.fonts.mono and mono.style.alignment == TA_RIGHT
    assert mid.style.fontName == ctx.styles.fonts.sans and mid.style.alignment == TA_CENTER
    assert plain.style.fontName == ctx.styles.fonts.sans and plain.style.alignment == TA_LEFT


def test_a_cover_block_off_the_cover_page_prints_plainly(tmp_path, ctx):
    from report_docs import cover_section

    blocks = document([cover_section()]).sections[0].blocks
    text = pdf_pages_text(_pdf(tmp_path, ctx, blocks))[0]
    assert "Quarterly inspection" in text and "Kuwait yard" in text and "Site locator" in text


def test_hostile_text_prints_literally(tmp_path, ctx):
    # Cyrillic, CJK and emoji have no glyphs in Space Grotesk (ruling P5, handed to R10): they must
    # not crash the render, but their extraction is not asserted.
    nasty = "<script>&amp; \x07 Трещина 裂缝 😀 m³"
    blocks = _blocks(
        {"kind": "para", "text": nasty, "style": "body"}, {"kind": "kv", "rows": [[nasty, nasty]]}
    )
    text = pdf_pages_text(_pdf(tmp_path, ctx, blocks))[0]
    assert "<script>&amp;" in text and "\x07" not in text


def test_a_missing_snapshot_is_a_placeholder_with_its_reason(tmp_path, caplog):
    ctx = context(Snapshots(tmp_path / "s", missing=frozenset({key("gone")})))
    blocks = _blocks(figure("gone", caption="Lost"))
    with caplog.at_level(logging.WARNING):
        text = pdf_pages_text(_pdf(tmp_path, ctx, blocks))[0]
    assert "Snapshot unavailable" in text and "Lost" in text and key("gone") in caplog.text


def test_empty_blocks_print_nothing_or_no_data(tmp_path, ctx):
    blocks = _blocks(
        {"kind": "kv", "rows": []},
        {"kind": "kpis", "items": []},
        {
            "kind": "table",
            "repeat_header": True,
            "columns": [{"key": "a", "label": "A", "align": "left"}],
            "rows": [],
        },
        {"kind": "chart", "chart": "bar", "series": [], "x_labels": [], "unit": ""},
    )
    assert "No data" in pdf_pages_text(_pdf(tmp_path, ctx, blocks))[0]


def test_a_300_row_table_with_huge_and_ragged_cells_repeats_its_header(tmp_path, ctx):
    rows = [[f"F-{i:04d}", "x" * 5000 if i == 5 else "Crack"] for i in range(300)]
    rows[7] = ["short"]  # too few cells
    rows[8] = ["a", "b", "c", "d"]  # too many
    blocks = _blocks(
        {
            "kind": "table",
            "repeat_header": True,
            "columns": [
                {"key": "number", "label": "Number", "align": "right", "width_mm": 25},
                {"key": "type", "label": "Kind", "align": "left"},
            ],
            "rows": rows,
        }
    )
    pages = pdf_pages_text(_pdf(tmp_path, ctx, blocks))
    assert len(pages) > 3 and all("Number" in p for p in pages)


def test_volume_block_uses_the_hook_and_falls_back_when_it_fails(tmp_path, caplog):
    vol = {
        "kind": "volume",
        "measurement_id": "m1",
        "title": "Stockpile A",
        "rows": [["Fill", "523.6 m³"]],
        "figure": figure("vp-m1"),
        "stale": False,
    }
    stale = dict(vol, stale=True, title="Stockpile B")
    hooked = context(Snapshots(tmp_path / "a"), volume_flowables=lambda b: [Paragraph(f"HOOK {b.title}")])
    assert "HOOK Stockpile A" in pdf_pages_text(_pdf(tmp_path, hooked, _blocks(vol), "h.pdf"))[0]

    def broken(block):
        raise RuntimeError("no such measurement")

    with caplog.at_level(logging.WARNING):
        path = _pdf(tmp_path, context(Snapshots(tmp_path / "b"), broken), _blocks(vol, stale), "b.pdf")
    text = "\n".join(pdf_pages_text(path))
    assert "Stockpile A" in text and "523.6" in text and "stale, recalculate" in text
    assert "no such measurement" in caplog.text


def test_the_volume_hook_may_not_swallow_a_cancel(tmp_path):
    def cancelled(block):
        raise JobCancelled()

    ctx = context(Snapshots(tmp_path / "c"), cancelled)
    vol = {"kind": "volume", "measurement_id": "m1", "title": "V", "rows": [], "stale": False}
    with pytest.raises(JobCancelled):
        flowables.block_flowables(_blocks(vol)[0], ctx)


def test_snapshot_refs_lists_every_embedded_snapshot():
    from report_docs import finding

    blocks = _blocks(
        figure("a"),
        {"kind": "figure_row", "figures": [figure("b"), figure("c")]},
        {"kind": "heading", "level": 1, "text": "x"},
    )
    assert [r.key for b in blocks for r in flowables.snapshot_refs(b)] == [key("a"), key("b"), key("c")]
    f = document([section("finding_pages", "F", [finding(1)])]).sections[0].blocks[0]
    expected = [key(n) for n in ("f1-main", "f1-a", "f1-b", "p1-0", "p1-1")]
    assert [r.key for r in flowables.snapshot_refs(f)] == expected
