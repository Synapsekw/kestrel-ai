"""The findings table's asset columns (spec 2026-10-02-asset-findings §10)."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model
from reports_rows import add_cloud, add_findings, add_type, config, ctx_for

from app.reports.sections import findings_table

COLS = ["number", "zone", "side", "height", "sightings"]


def _table(handle):
    cfg = config(
        sections=("findings_table",), options={"findings_table": {"columns": COLS, "sort": "number"}}
    )
    [table] = findings_table.compose(ctx_for(handle, cfg)).blocks
    return table


def test_asset_findings_print_zone_side_height_and_sightings(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    imgs = [add_asset_image(handle, name=f"DJI_000{i}.JPG") for i in range(3)]
    zone = review.zones[0]
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": i} for i in imgs],
        zone=zone.id,
        side="West elevation",
        height=41.24,
        bearing=270.0,
        center=(-5.0, 41.24, 0.0),
    )
    add_asset_finding(
        handle, mid, crack, sightings=[{"image_id": imgs[0], "placement": "none"}], placement="none"
    )
    table = _table(handle)
    assert [c.label for c in table.columns] == ["No.", "Zone", "Side", "Height", "Sightings"]
    assert [str(c.align) for c in table.columns] == ["left", "left", "left", "right", "right"]
    assert table.rows == [
        ["F-0001", zone.label, "West elevation", "41.2 m", "3"],
        ["F-0002", "Not placed", "Not placed", "Not placed", "1"],
    ]


def test_the_asset_columns_are_blank_for_other_anchors(handle):
    t = add_type(handle, "crack")
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": add_cloud(handle)}])
    assert _table(handle).rows == [["F-0001", "", "", "", ""]]
