"""Compose plumbing for asset findings: the row fields, the asset model cache, the representative
sighting, the extra WHERE and the observed date and label of `asset_model` findings."""

from reports_asset_rows import T0, add_asset_finding, add_asset_image, add_asset_model
from reports_rows import add_type, config, ctx_for

from app.db.models import Finding, FindingSighting
from app.findings.sightings import sort_key
from app.reports.asset_info import ASSET, NOT_PLACED, representative
from app.reports.context import count_findings, findings_page


def test_a_finding_row_carries_the_asset_fields(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    img = add_asset_image(handle, name="DJI_0001.JPG")
    zone = review.zones[0].id
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": img, "center": (1.0, 41.2, -3.0), "normal": (0.0, 0.0, -1.0)}],
        zone=zone,
        side="West elevation",
        height=41.2,
        bearing=270.0,
        center=(1.0, 41.2, -3.0),
        normal=(0.0, 0.0, -1.0),
        component="Panel",
    )
    ctx = ctx_for(handle, config(sections=("finding_pages",)))
    [row], _ = findings_page(ctx)
    assert (row.anchor_kind, row.asset_model_id, row.asset_version) == ("asset", mid, 1)
    assert (row.height_m, row.bearing_deg, row.side, row.zone) == (41.2, 270.0, "West elevation", zone)
    assert (row.placement, row.sighting_count, row.component) == ("patch", 1, "Panel")
    assert (row.ax, row.ay, row.az, row.an_z) == (1.0, 41.2, -3.0, -1.0)
    assert row.data_label == "Tower A"
    assert row.observed_on == T0.date()


def test_the_context_caches_asset_models_with_their_frame_and_review(handle):
    mid, review, frame = add_asset_model(handle, name="Stack 3", profile="stack")
    ctx = ctx_for(handle, config())
    info = ctx.asset_models[mid]
    assert (info.name, info.current_version) == ("Stack 3", 1)
    assert info.frame.height_m == frame.height_m
    assert info.zone_label(review.zones[0].id) == review.zones[0].label
    assert info.zone_label("gone") == "gone" and info.zone_label(None) is None
    assert ctx.asset_models is ctx.asset_models  # read once per context


def test_the_representative_is_worst_then_placed_then_largest(handle):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    a, b, c = (add_asset_image(handle, name=f"DJI_000{i}.JPG") for i in (1, 2, 3))
    fid = add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[
            {"image_id": a, "severity": 1, "center": (0.0, 1.0, 0.0), "coverage": 0.9, "id": "s-a"},
            {"image_id": b, "severity": 2, "placement": "none", "coverage": 0.5, "id": "s-b"},
            {"image_id": c, "severity": 2, "center": (0.0, 2.0, 0.0), "coverage": 0.1, "id": "s-c"},
        ],
    )
    with handle.session() as s:
        assert representative(s, fid).id == "s-c"


def test_the_representative_reads_no_coverage_as_zero_like_the_findings_sort(handle):
    """findings/sightings.sort_key treats a None coverage as 0: a tie then goes to the older one."""
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    a, b = (add_asset_image(handle, name=f"DJI_000{i}.JPG") for i in (1, 2))
    fid = add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[
            {"image_id": a, "center": (0.0, 1.0, 0.0), "id": "s-old"},
            {"image_id": b, "center": (0.0, 2.0, 0.0), "coverage": 0.0, "id": "s-new"},
        ],
    )
    with handle.session() as s:
        rows = s.query(FindingSighting).filter(FindingSighting.finding_id == fid).all()
        assert min(rows, key=sort_key).id == "s-old"
        assert representative(s, fid).id == "s-old"


def test_an_extra_where_narrows_the_page_and_the_count(handle):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    img = add_asset_image(handle, name="DJI_0001.JPG")
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": img}], severity=1)
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": img}], severity=2)
    ctx = ctx_for(handle, config(sections=("finding_pages",)))
    where = Finding.severity >= 2
    rows, nxt = findings_page(ctx, "number", None, 50, where=where)
    assert [r.severity for r in rows] == [2] and nxt is None
    assert count_findings(ctx, where=where) == 1 and count_findings(ctx) == 2


def test_the_shared_asset_predicate_and_copy(handle):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    img = add_asset_image(handle, name="DJI_0001.JPG")
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": img}])
    ctx = ctx_for(handle, config(sections=("finding_pages",)))
    assert count_findings(ctx, where=ASSET) == 1
    assert NOT_PLACED == "Not placed"
