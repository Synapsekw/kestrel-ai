"""R9-M's seam: every figure is a SnapshotRef whose key is R3's key for its spec (spec §8.2 step 4,
§9.1), sized per Ruling 1."""

from datetime import date

from reports_m_rows import add_dem, add_geomap, make_ctx
from reports_rows import config, ctx_for

from app.reports.figures import map_geo, map_specs
from app.reports.snapshots.keys import snapshot_key


def test_a_map_figure_references_the_spec_by_r3s_key(handle):
    # key_for=None so this one test exercises the real R3 snapshot_key path (controller notes).
    mid = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    ctx = ctx_for(handle, config(sections=("measurements",)), key_for=None)
    fig = map_specs.map_figure(
        ctx,
        map_id=mid,
        geometry=map_geo.point(500050.0, 4982950.0),
        colour="#FF0000",
        label="F-0001 · Crack",
        caption="Sep · 01 Sep 2026",
        size_mm=map_specs.MAIN_MM,
        inset=True,
    )
    spec = fig.snapshot.spec
    assert spec.kind == "map" and spec.item_id == mid and spec.inset is True
    assert list(spec.out) == [1200, 900]
    assert fig.snapshot.key == snapshot_key(handle, spec)
    assert (fig.width_mm, fig.height_mm) == (140.0, 105.0)
    assert (fig.snapshot.width_px, fig.snapshot.height_px) == (1200, 900)


def test_an_elevation_figure_uses_the_surface_id(handle):
    sid = add_dem(handle)
    ctx = make_ctx(handle)
    fig = map_specs.elevation_figure(
        ctx, surface_id=sid, geometry=map_geo.line([[500010, 4982990], [500020, 4982980]]), caption="c"
    )
    assert fig.snapshot.spec.kind == "elevation" and fig.snapshot.spec.item_id == sid


def test_a_pair_figure_carries_both_maps_the_frame_and_the_mode(handle):
    a = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    b = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    ring = [[500000, 4982900], [500100, 4982900], [500100, 4983000], [500000, 4983000]]
    ctx = make_ctx(handle)
    fig = map_specs.pair_figure(
        ctx,
        a_id=a,
        a_ring=ring,
        b_id=b,
        b_ring=ring,
        bbox_wgs84=(15.0, 45.0, 15.001, 45.001),
        mode="swipe",
        caption="A: Aug   B: Sep",
    )
    spec = fig.snapshot.spec
    assert spec.kind == "pair" and spec.mode == "swipe" and spec.split == 0.5
    assert spec.a.item_id == a and spec.b.item_id == b
    assert list(spec.bbox_wgs84) == [15.0, 45.0, 15.001, 45.001]


def test_a_volume_plan_figure(handle):
    ctx = make_ctx(handle)
    fig = map_specs.volume_plan_figure(ctx, measurement_id="v1", caption="Plan of Pile 1")
    assert fig.snapshot.spec.kind == "volume_plan" and fig.snapshot.spec.measurement_id == "v1"
    assert (fig.snapshot.width_px, fig.snapshot.height_px) == (1200, 900)


def test_options_of_reads_a_sections_options(handle):
    ctx = make_ctx(handle, "object_counts", per_area=False)
    assert map_specs.options_of(ctx, "object_counts")["per_area"] is False
    assert map_specs.options_of(ctx, "no_such_section") == {}


def test_type_look_falls_back_for_an_unknown_type(handle, project):
    with handle.session() as s:
        known = project["classes"][0]
        assert map_specs.type_look(s, known["id"]) == (known["name"], known["colour"])
        assert map_specs.type_look(s, "gone") == ("Unknown type", "#8F7BFF")
