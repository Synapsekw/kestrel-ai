"""The findings table (spec §7.2): plain string rows, 25 per block, each sort, bounded pages."""

from datetime import UTC, datetime, timedelta

from reports_rows import T0, add_cloud, add_findings, add_type, config, ctx_for

from app.reports.sections import findings_table as ft


def _cfg(**opts):
    return config(sections=("findings_table",), options={"findings_table": opts})


def _rows(doc):
    return [r for b in doc.blocks for r in b.model_dump(mode="json")["rows"]]


def test_default_columns_and_cells(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(
        handle,
        [
            {
                "type_id": t,
                "severity": 3,
                "anchor": "cloud",
                "target": c,
                "note": "Wide",
                "status": "reviewed",
                "created_at": datetime(2026, 9, 24, tzinfo=UTC),
            }
        ],
    )
    doc = ft.compose(ctx_for(handle, _cfg()))
    head = doc.blocks[0].model_dump(mode="json")
    assert [col["key"] for col in head["columns"]] == [
        "number",
        "type",
        "severity",
        "status",
        "data_item",
        "observed",
        "note",
    ]
    assert round(sum(col["width_mm"] for col in head["columns"]), 1) == 174.0
    assert head["repeat_header"] is True
    assert _rows(doc) == [["F-0001", "crack", "Major", "Reviewed", "Scan", "24 Sep 2026", "Wide"]]


def test_column_subset_keeps_the_option_order_and_full_width(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": c}])
    head = ft.compose(ctx_for(handle, _cfg(columns=["status", "number"]))).blocks[0].model_dump(mode="json")
    assert [col["key"] for col in head["columns"]] == ["status", "number"]
    assert round(sum(col["width_mm"] for col in head["columns"]), 0) == 174


def test_each_sort(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust")
    c = add_cloud(handle)
    add_findings(
        handle,
        [
            {
                "type_id": rust,
                "severity": 1,
                "anchor": "cloud",
                "target": c,
                "created_at": T0 + timedelta(days=3),
            },
            {
                "type_id": crack,
                "severity": None,
                "anchor": "cloud",
                "target": c,
                "created_at": T0 + timedelta(days=1),
            },
            {
                "type_id": crack,
                "severity": 4,
                "anchor": "cloud",
                "target": c,
                "created_at": T0 + timedelta(days=2),
            },
        ],
    )
    order = lambda sort: [r[0] for r in _rows(ft.compose(ctx_for(handle, _cfg(sort=sort))))]  # noqa: E731
    assert order("number") == ["F-0001", "F-0002", "F-0003"]
    assert order("severity_desc") == ["F-0003", "F-0001", "F-0002"]
    assert order("type") == ["F-0002", "F-0003", "F-0001"]
    assert order("observed") == ["F-0002", "F-0003", "F-0001"]


def test_201_findings_make_nine_blocks_and_page_boundedly(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": c} for _ in range(201)])
    ctx = ctx_for(handle, _cfg(sort="number"))
    doc = ft.compose(ctx)
    assert len(doc.blocks) == 9 and len(_rows(doc)) == 201
    items, cur = ft.page(ctx, None, 2)
    assert len(items) == 2 and sum(len(b.rows) for b in items) == 50 and cur
    stats = ft.outline(ctx)
    assert (stats.block_count, stats.estimated_pages) == (9, 6)


def test_note_excerpt_is_one_line_and_bounded():
    assert ft.excerpt("a\n\nb   <c> & d") == "a b <c> & d"
    long = ft.excerpt("word " * 1000)
    assert len(long) <= 120 and long.endswith("…") and "\n" not in long


def test_empty_is_one_note(handle):
    doc = ft.compose(ctx_for(handle, _cfg()))
    assert doc.blocks[0].model_dump()["text"] == "No findings match the filters"
