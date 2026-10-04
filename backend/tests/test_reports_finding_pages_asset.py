"""Asset finding pages (spec 2026-10-02-asset-findings §10) and finding_pages.min_severity."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose
from reports_rows import add_findings, add_image, add_type, config, ctx_for

from app.reports.sections import asset_pages, finding_pages


def _seed(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    zone = review.zones[1]
    a = add_asset_image(handle, name="DJI_0101.JPG")
    b = add_asset_image(handle, name="DJI_0102.JPG")
    add_pose(handle, a, mid, sequence="3")
    add_pose(handle, b, mid)
    add_asset_finding(
        handle,
        mid,
        crack,
        severity=2,
        note="Open joint.",
        zone=zone.id,
        side="West elevation",
        height=41.2,
        bearing=271.0,
        center=(-5.0, 41.2, 0.5),
        normal=(-1.0, 0.0, 0.0),
        component="Panel",
        sightings=[
            {
                "image_id": a,
                "center": (-5.0, 41.2, 0.5),
                "normal": (-1.0, 0.0, 0.0),
                "coverage": 0.0125,
                "id": "s-rep",
            },
            {"image_id": b, "severity": 1, "center": (-5.1, 41.0, 0.4), "coverage": 0.3},
        ],
    )
    return crack, mid, zone, a


def _ctx(handle, **opts):
    cfg = config(
        sections=("finding_pages",),
        options={"finding_pages": {"photos_max": 0, "comments": "none", **opts}},
    )
    return ctx_for(handle, cfg)


def test_the_kicker_names_number_zone_side_and_sightings(handle):
    _, _, zone, _ = _seed(handle)
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset.kicker == f"Finding F-0001 · {zone.label} · West elevation · seen in 2 photos"


def _unit_kicker(handle, profile, images):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle, profile=profile)
    ids = [add_asset_image(handle, name=f"DJI_{i:04d}.JPG") for i in range(images)]
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": ids[i % images]} for i in range(3)])
    [b] = finding_pages.compose(_ctx(handle)).blocks
    return b


def test_a_photo_unit_finding_counts_regions_on_one_photo(handle):
    b = _unit_kicker(handle, "stack", 1)
    assert b.asset.kicker.endswith("3 regions on 1 photo")
    assert "seen in" not in b.asset.kicker


def test_a_region_unit_finding_keeps_seen_in_photos(handle):
    b = _unit_kicker(handle, "building_facade", 3)
    assert b.asset.kicker.endswith("seen in 3 photos")


def test_the_singular_forms(handle):
    assert asset_pages.sightings_phrase("photo", 1, 1) == "1 region on 1 photo"
    assert asset_pages.sightings_phrase("photo", 2, 2) == "2 regions on 2 photos"
    assert asset_pages.sightings_phrase("region", 1, 1) == "seen in 1 photo"


def test_figures_are_the_photo_the_3d_locator_and_the_close_up(handle):
    _, mid, _, a = _seed(handle)
    ctx = _ctx(handle)
    [b] = finding_pages.compose(ctx).blocks
    wide, loc, close = (f.snapshot.spec for f in b.figures)
    assert (wide.kind, loc.kind, close.kind) == ("image_crop", "asset_locator", "image_crop")
    assert (wide.context, close.context) == (asset_pages.WIDE_CONTEXT, asset_pages.CLOSE_CONTEXT)
    assert wide.image_id == close.image_id == a  # the representative (worst) sighting's photo
    info = ctx.asset_models[mid]
    assert (loc.asset_model_id, loc.version, loc.mark, loc.sighting_id) == (mid, 1, "patch", "s-rep")
    assert loc.center == [-5.0, 41.2, 0.5] and loc.normal == [-1.0, 0.0, 0.0]
    assert loc.colour == b.head.severity_colour
    assert (loc.oblique_deg, loc.half_extent_m) == (
        asset_pages.oblique_of(info),
        asset_pages.half_extent_of(info),
    )
    assert [f.caption for f in b.figures][1] == asset_pages.LOCATOR_CAPTION


def test_snapshot_options_switch_the_photo_and_the_locator_off(handle):
    _seed(handle)
    [b] = finding_pages.compose(_ctx(handle, snapshots=["image"])).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["image_crop", "image_crop"]
    [b] = finding_pages.compose(_ctx(handle, snapshots=["cloud"])).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["asset_locator"]


def test_the_height_locator_and_the_facts(handle):
    _, _, zone, _ = _seed(handle)
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset.height_locator.x_title == "41.2 m"
    kv = dict(b.kv)
    assert b.kv[0][0] == "Severity"
    assert kv["Height"] == "41.2 m above street level"
    assert kv["Zone"] == zone.label
    assert kv["Source photo"] == "DJI_0101.JPG · flight 3"
    assert kv["Side"].startswith("West elevation · ") and "271" in kv["Side"]
    assert b.note == "Open joint."


def test_an_unplaced_finding_has_no_locator_and_says_so(handle):
    crack = add_type(handle, "rust")
    mid, _, _ = add_asset_model(handle)
    a = add_asset_image(handle, name="DJI_0200.JPG")
    add_asset_finding(handle, mid, crack, placement="none", sightings=[{"image_id": a, "placement": "none"}])
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["image_crop", "image_crop"]
    assert b.asset.height_locator is None and "not placed on the model" in b.asset.kicker
    assert dict(b.kv)["Height"] == asset_pages.NOT_PLACED_TEXT


def test_min_severity_prints_only_the_worse_findings(handle):
    crack, mid, _, a = _seed(handle)  # F-0001, severity 2
    add_asset_finding(handle, mid, crack, severity=1, sightings=[{"image_id": a}])  # F-0002
    add_asset_finding(handle, mid, crack, severity=None, sightings=[{"image_id": a}])  # F-0003
    ctx = _ctx(handle, min_severity=2)
    assert [b.number for b in finding_pages.compose(ctx).blocks] == [1]
    assert finding_pages.outline(ctx).estimated_pages == 1
    assert len(finding_pages.compose(_ctx(handle)).blocks) == 3


def test_image_findings_keep_the_image_page(handle):
    t = add_type(handle, "crack")
    img, _ = add_image(handle)
    add_findings(handle, [{"type_id": t, "anchor": "image", "target": img}])
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset is None
