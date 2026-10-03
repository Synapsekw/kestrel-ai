"""asset_summary (spec 2026-10-02-asset-findings §10): tiles, the map, zone and side breakdowns, for
one asset model (the chosen one, else the first with findings in the filter)."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose, add_review
from reports_rows import add_cloud, add_findings, add_type, config, ctx_for

from app.db.models import AssetModel
from app.reports import compose
from app.reports.sections import asset_summary


def _seed(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust")
    mid, review, _ = add_asset_model(handle)
    z0, z1 = review.zones[0].id, review.zones[1].id
    imgs = [add_asset_image(handle, name=f"DJI_{i:04d}.JPG") for i in range(4)]
    for i in imgs:
        add_pose(handle, i, mid)
    add_review(handle, imgs[1], "none")
    add_review(handle, imgs[2], "uncertain")
    add_review(handle, imgs[3], "uncertain")
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": imgs[0]}, {"image_id": imgs[1]}],
        severity=2,
        zone=z0,
        side="North elevation",
        height=55.0,
        bearing=10.0,
        center=(5.0, 55.0, 1.0),
    )
    add_asset_finding(
        handle,
        mid,
        rust,
        sightings=[{"image_id": imgs[0]}],
        severity=1,
        zone=z1,
        side="West elevation",
        height=40.0,
        bearing=270.0,
        center=(-5.0, 40.0, 0.0),
    )
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": imgs[2]}], severity=1, placement="none")
    return mid, review


def _compose(handle, **opts):
    ctx = ctx_for(handle, config(sections=("asset_summary",), options={"asset_summary": opts}))
    return ctx, asset_summary.compose(ctx)


def test_the_section_is_registered():
    assert compose.SECTION_MODULES["asset_summary"] is asset_summary
    assert compose.section_title("asset_summary") == "Asset summary"


def test_tiles_count_findings_severities_sightings_and_uncertain_photos(handle):
    _seed(handle)
    ctx, doc = _compose(handle)
    assert (doc.blocks[0].kind, doc.blocks[0].text) == ("heading", "Tower A")
    tiles = {i.label: i.value for i in doc.blocks[1].items}
    assert (tiles["Findings"], tiles["Sightings"], tiles["Uncertain photos"]) == ("3", "4", "2")
    assert (tiles[ctx.level(2).name], tiles[ctx.level(1).name]) == ("1", "2")
    colours = {i.label: i.colour for i in doc.blocks[1].items}
    assert colours[ctx.level(2).name] == ctx.level(2).colour


def test_the_map_has_one_dot_per_placed_finding(handle):
    _seed(handle)
    _, doc = _compose(handle)
    [m] = [b for b in doc.blocks if b.kind == "asset_map"]
    assert m.title == "" and m.caption == asset_summary.MAP_CAPTION
    assert {d.label for d in m.drawing.dots} == {"F-0001", "F-0002"}


def test_zone_and_side_tables(handle):
    _, review = _seed(handle)
    _, doc = _compose(handle)
    zones, sides = [b for b in doc.blocks if b.kind == "table"]
    totals = {r[0]: r[-1] for r in zones.rows}
    assert len(zones.rows) == len(review.zones) + 1
    assert (totals[review.zones[0].label], totals[review.zones[1].label], totals["Not placed"]) == (
        "1",
        "1",
        "1",
    )
    labels = [r[0] for r in sides.rows]
    assert labels[-1] == "Not placed" and set(labels[:-1]) == {"North elevation", "West elevation"}
    assert [c.label for c in zones.columns][-1] == "Total"


def test_the_options_switch_the_map_and_the_tables_off(handle):
    _seed(handle)
    _, doc = _compose(handle, show_map=False, show_tables=False)
    assert [b.kind for b in doc.blocks] == ["heading", "kpis"]


def test_the_chosen_model_wins_over_the_first(handle):
    _seed(handle)
    other, _, _ = add_asset_model(handle, name="Annex")
    img = add_asset_image(handle, name="DJI_0999.JPG")
    add_asset_finding(
        handle, other, add_type(handle, "dent"), sightings=[{"image_id": img}], placement="none"
    )
    _, doc = _compose(handle, asset_model_id=other)
    assert doc.blocks[0].text == "Annex"
    assert {i.label: i.value for i in doc.blocks[1].items}["Findings"] == "1"


def test_no_asset_findings_prints_the_empty_line(handle):
    t = add_type(handle, "crack")
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": add_cloud(handle)}])
    _, doc = _compose(handle)
    assert [(b.kind, b.text) for b in doc.blocks] == [("para", asset_summary.EMPTY)]


def test_a_model_without_a_frame_prints_a_note_instead_of_the_map(handle):
    mid, _ = _seed(handle)
    with handle.session() as s:
        s.get(AssetModel, mid).frame = None
    _, doc = _compose(handle)
    assert not [b for b in doc.blocks if b.kind == "asset_map"]
    assert any(b.kind == "para" and b.text == asset_summary.NO_FRAME for b in doc.blocks)


def test_outline_is_one_page(handle):
    _seed(handle)
    ctx, doc = _compose(handle)
    stats = asset_summary.outline(ctx)
    assert (stats.block_count, stats.estimated_pages) == (len(doc.blocks), 1)
