"""The data-item appendix, methods and model provenance (spec §7.2)."""

from datetime import date

from reports_rows import add_cloud, add_findings, add_image, add_map, add_type, config, ctx_for

from app.reports.sections import appendix


def _dump(ctx):
    return [b.model_dump(mode="json") for b in appendix.compose(ctx).blocks]


def test_one_row_per_data_item_in_type_order(handle):
    _, src = add_image(handle, captured_on=date(2026, 9, 10))
    add_map(handle, name="Ortho", captured_on=date(2026, 9, 20))
    add_cloud(handle, name="Scan")
    out = _dump(
        ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": False}}))
    )
    assert [b["kind"] for b in out] == ["table"]
    assert out[0]["rows"] == [
        ["Image set", "Flight", "10 Sep 2026", "0 images", "-"],
        ["Map", "Ortho", "20 Sep 2026", "100×80 px · GSD 2.5 cm", "EPSG:32633"],
        ["Point cloud", "Scan", "-", "1,000 points", "EPSG:32633"],
    ]


def test_the_data_item_filter_limits_rows(handle):
    add_map(handle, name="A")
    b = add_map(handle, name="B")
    out = _dump(
        ctx_for(
            handle,
            config(
                sections=("appendix",),
                filters={"data_item_ids": [b]},
                options={"appendix": {"include_methods": False}},
            ),
        )
    )
    assert [r[1] for r in out[0]["rows"]] == ["B"]


def test_methods_and_model_provenance(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(
        handle,
        [
            {"type_id": t, "anchor": "cloud", "target": c, "created_by": "model:yolo11s", "confidence": 0.8},
            {"type_id": t, "anchor": "cloud", "target": c, "created_by": "model:yolo11s", "confidence": 0.6},
            {"type_id": t, "anchor": "cloud", "target": c},
        ],
    )
    out = _dump(
        ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": True}}))
    )
    texts = [b.get("text") for b in out]
    assert "Methods" in texts and "Model provenance" in texts
    assert any("1 Minor, 2 Moderate, 3 Major, 4 Critical" in (t or "") for t in texts)
    assert out[-1]["rows"] == [["model:yolo11s", "2", "0.70"]]


def test_no_data_items(handle):
    out = _dump(
        ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": False}}))
    )
    assert out == [{**out[0], "kind": "para", "text": "No data items"}]


def test_outline_block_count_matches_compose_with_no_items(handle):
    ctx = ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": True}}))
    assert appendix.outline(ctx).block_count == len(appendix.compose(ctx).blocks)


def test_outline_block_count_matches_compose_with_methods_and_provenance(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_map(handle, name="Ortho")
    add_findings(
        handle,
        [
            {"type_id": t, "anchor": "cloud", "target": c, "created_by": "model:yolo11s", "confidence": 0.8},
            {"type_id": t, "anchor": "cloud", "target": c},
        ],
    )
    ctx = ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": True}}))
    assert appendix.outline(ctx).block_count == len(appendix.compose(ctx).blocks)


def test_outline_block_count_matches_compose_with_data_item_filter(handle):
    add_map(handle, name="A")
    b = add_map(handle, name="B")
    ctx = ctx_for(
        handle,
        config(
            sections=("appendix",),
            filters={"data_item_ids": [b]},
            options={"appendix": {"include_methods": True}},
        ),
    )
    assert appendix.outline(ctx).block_count == len(appendix.compose(ctx).blocks)


def test_outline_block_count_matches_compose_with_include_methods_false(handle):
    add_map(handle, name="Ortho")
    add_cloud(handle, name="Scan")
    ctx = ctx_for(handle, config(sections=("appendix",), options={"appendix": {"include_methods": False}}))
    assert appendix.outline(ctx).block_count == len(appendix.compose(ctx).blocks)
