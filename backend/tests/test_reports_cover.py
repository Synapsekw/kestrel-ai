"""The cover (spec §7.2; plan R2 Rulings 1, 2, 15)."""

from datetime import UTC, date, datetime

from reports_rows import GEN, add_asset, add_cloud, add_findings, add_map, add_type, config, ctx_for

from app.reports.sections import cover


def _cover(handle, cfg, **kw):
    return cover.compose(ctx_for(handle, cfg, **kw)).blocks[0].model_dump(mode="json")


def test_rows_period_and_marks(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(
        handle,
        [
            {"type_id": t, "anchor": "cloud", "target": c, "created_at": datetime(2026, 9, 3, tzinfo=UTC)},
            {"type_id": t, "anchor": "cloud", "target": c, "created_at": datetime(2026, 9, 21, tzinfo=UTC)},
        ],
    )
    cfg = config(
        sections=("cover",),
        cover={"subtitle": "Level 3", "site": "North pier", "client": "ACME"},
        options={"cover": {"show_locator": False}},
    )
    b = _cover(handle, cfg)
    assert b["kind"] == "cover" and b["title"] == "Site inspection" and b["subtitle"] == "Level 3"
    rows = dict(map(tuple, b["rows"]))
    assert rows["Site"] == "North pier" and rows["Client"] == "ACME" and rows["Author"] == "D. J."
    assert rows["Report date"] == "30 Sep 2026" and rows["Period"] == "3 Sep 2026 – 21 Sep 2026"
    assert (rows["Version"], rows["Status"]) == ("Preview", "Draft")
    assert b["logo"] is None and b["locator"] is None
    b = _cover(handle, cfg, version=3, issued=True)
    rows = dict(map(tuple, b["rows"]))
    assert (rows["Version"], rows["Status"]) == ("v003", "Issued")


def test_report_date_and_empty_period(handle):
    b = _cover(
        handle,
        config(
            sections=("cover",),
            cover={"report_date": "2026-09-24"},
            options={"cover": {"show_locator": False}},
        ),
    )
    rows = dict(map(tuple, b["rows"]))
    assert rows["Report date"] == "24 Sep 2026" and rows["Period"] == "—"


def test_locator_is_a_map_ref_on_the_first_map(handle):
    add_map(handle, name="Old", captured_on=date(2026, 8, 1), bounds=[0, 0, 100, 80])
    new = add_map(
        handle, name="New", captured_on=date(2026, 9, 20), bounds=[500000, 5000000, 500400, 5000300]
    )
    add_map(handle, name="No bounds", captured_on=date(2026, 9, 25))
    b = _cover(handle, config(sections=("cover",)))
    loc = b["locator"]
    spec = loc["snapshot"]["spec"]
    assert spec["kind"] == "map" and spec["item_id"] == new and spec["out"] == [1200, 900]
    assert spec["geometry"]["coordinates"][0][0] == [500000, 5000000]
    assert (loc["width_mm"], loc["height_mm"], loc["caption"]) == (80, 60, "New · 20 Sep 2026")
    assert len(loc["snapshot"]["key"]) == 32


def test_locator_respects_the_data_item_filter(handle):
    old = add_map(handle, name="Old", captured_on=date(2026, 8, 1), bounds=[0, 0, 100, 80])
    add_map(handle, name="New", captured_on=date(2026, 9, 20), bounds=[0, 0, 100, 80])
    b = _cover(handle, config(sections=("cover",), filters={"data_item_ids": [old]}))
    assert b["locator"]["snapshot"]["spec"]["item_id"] == old


def test_logo_is_resolved_or_warned(handle):
    aid = add_asset(handle)
    (handle.folder / "reports" / "assets").mkdir(parents=True, exist_ok=True)
    (handle.folder / "reports" / "assets" / "logo-abcd1234.png").write_bytes(b"png")
    cfg = config(
        sections=("cover",), cover={"logo_asset_id": aid}, options={"cover": {"show_locator": False}}
    )
    b = _cover(handle, cfg)
    assert b["logo"] == {
        "asset_id": aid,
        "path": "reports/assets/logo-abcd1234.png",
        "width_px": 600,
        "height_px": 200,
    }
    ctx = ctx_for(
        handle,
        config(
            sections=("cover",), cover={"logo_asset_id": "gone"}, options={"cover": {"show_locator": False}}
        ),
    )
    assert cover.compose(ctx).blocks[0].model_dump()["logo"] is None
    assert [w.code for w in ctx.warnings] == ["logo_missing"]
    assert GEN  # generated_at stays the only clock
