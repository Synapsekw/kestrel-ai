"""R9-C finding figures: fresh view, stale view, missing view with and without a cloud DSM."""

import pytest
from reports_cloud_rows import (
    X,
    Y,
    cloud_finding,
    insert_cloud,
    insert_surface,
    make_ctx,
    make_stale,
    row_of,
    store_finding_view,
)

from app.pointclouds import views
from app.reports.figures import cloud
from app.reports.snapshots.keys import snapshot_key


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _codes(ctx):
    return {w.code: w for w in ctx.warnings if w.code in (cloud.STALE, cloud.MISSING_CODE)}


def test_a_fresh_view_is_one_view3d_figure_and_no_warning(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    stored = store_finding_view(handle, f.id)
    ctx = make_ctx(handle)
    (fig,) = cloud.finding_figures(ctx, row_of(handle, f.id))
    spec = fig.snapshot.spec
    assert (spec.kind, spec.subject_kind, spec.subject_id, spec.cloud_id) == (
        "view3d",
        "finding",
        f.id,
        cloud_id,
    )
    assert (fig.snapshot.width_px, fig.snapshot.height_px) == (1600, 1000)
    assert (fig.width_mm, fig.height_mm) == cloud.VIEW_MM
    assert fig.snapshot.missing_reason is None
    assert fig.snapshot.key == snapshot_key(handle, spec)
    assert fig.caption == f"3D view, captured {stored.captured_at:%d %b %Y}"
    assert _codes(ctx) == {}


def test_a_stale_view_prints_and_warns_with_the_finding_link(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    make_stale(handle, finding_id=f.id)
    ctx = make_ctx(handle)
    (fig,) = cloud.finding_figures(ctx, row_of(handle, f.id))
    assert fig.snapshot.spec.kind == "view3d" and fig.snapshot.missing_reason is None
    assert fig.caption.endswith(" (out of date: the anchor moved after capture)")
    w = _codes(ctx)[cloud.STALE]
    assert (w.message, w.link) == (
        "1 3D view is out of date",
        f"/p/{handle.id}/clouds/{cloud_id}?finding={f.id}",
    )


def test_no_view_with_a_covering_dsm_is_a_hillshade_plan(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    sid = insert_surface(handle, cloud_id)
    ctx = make_ctx(handle)
    (fig,) = cloud.finding_figures(ctx, row_of(handle, f.id))
    spec = fig.snapshot.spec
    assert (spec.kind, spec.item_id) == ("elevation", sid)
    assert spec.geometry.model_dump() == {"type": "Point", "coordinates": [X, Y]}
    assert (fig.snapshot.width_px, fig.snapshot.height_px) == cloud.PLAN_OUT
    assert (fig.width_mm, fig.height_mm) == cloud.PLAN_MM
    assert fig.caption == "Plan view of DSM 14 Sep: no 3D view saved"
    w = _codes(ctx)[cloud.MISSING_CODE]
    assert (w.message, w.link) == ("1 3D view is missing", f"/p/{handle.id}/clouds/{cloud_id}?finding={f.id}")


def test_no_view_and_no_dsm_is_a_placeholder_with_the_reason(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    insert_surface(handle, cloud_id, bounds=(0, 0, 1, 1))  # does not cover
    ctx = make_ctx(handle)
    (fig,) = cloud.finding_figures(ctx, row_of(handle, f.id))
    assert fig.snapshot.spec.kind == "view3d"
    assert fig.snapshot.missing_reason == "No 3D view saved. Open this finding in Point clouds to capture one"
    assert fig.caption == "No 3D view"
    assert fig.snapshot.key == snapshot_key(handle, fig.snapshot.spec)
    assert cloud.MISSING_CODE in _codes(ctx)


def test_a_row_without_its_file_is_treated_as_missing(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    views.remove_files(handle, cloud_id, "finding", f.id)
    ctx = make_ctx(handle)
    (fig,) = cloud.finding_figures(ctx, row_of(handle, f.id))
    assert fig.snapshot.missing_reason is not None
    assert cloud.MISSING_CODE in _codes(ctx)


def test_a_non_cloud_finding_has_no_cloud_figure(handle, crack):
    from findings_helpers import insert_map

    from app.findings import service
    from app.findings.anchors import AnchorIn

    anchor = AnchorIn(
        kind="map", map_id=insert_map(handle), geometry={"type": "Point", "coordinates": [1.0, 2.0]}
    )
    f = service.create_finding(handle, type_id=crack["id"], anchor=anchor, lon=47.76, lat=29.49)
    ctx = make_ctx(handle)
    assert cloud.finding_figures(ctx, row_of(handle, f.id)) == []
    assert _codes(ctx) == {}


def test_warnings_aggregate_to_one_entry_per_code(handle, crack, cloud_id):
    ctx = make_ctx(handle)
    for i in range(3):
        f = cloud_finding(handle, crack["id"], cloud_id, x=X + i)
        cloud.finding_figures(ctx, row_of(handle, f.id))
    for i in range(2):
        f = cloud_finding(handle, crack["id"], cloud_id, x=X + 10 + i)
        store_finding_view(handle, f.id)
        make_stale(handle, finding_id=f.id)
        cloud.finding_figures(ctx, row_of(handle, f.id))
    codes = _codes(ctx)
    assert [w.code for w in ctx.warnings].count(cloud.MISSING_CODE) == 1
    assert codes[cloud.MISSING_CODE].message == "3 3D views are missing"
    assert codes[cloud.STALE].message == "2 3D views are out of date"


def test_the_same_state_composes_the_same_figure(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    a = cloud.finding_figures(make_ctx(handle), row_of(handle, f.id))
    b = cloud.finding_figures(make_ctx(handle), row_of(handle, f.id))
    assert [x.model_dump() for x in a] == [x.model_dump() for x in b]
