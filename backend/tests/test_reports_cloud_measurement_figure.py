"""R9-C measurement figure: fresh, stale, missing with and without a cloud DSM, area polygon."""

import pytest
from reports_cloud_rows import (
    X,
    Y,
    Z,
    cloud_measurement,
    insert_cloud,
    insert_surface,
    make_ctx,
    make_stale,
    measurement_row,
    store_measurement_view,
)

from app.reports import blocks
from app.reports.figures import cloud


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _codes(ctx):
    return {w.code: w for w in ctx.warnings if w.code in (cloud.STALE, cloud.MISSING_CODE)}


def test_a_fresh_measurement_view(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id, name="Stack height")
    stored = store_measurement_view(handle, cloud_id, mid)
    ctx = make_ctx(handle)
    fig = cloud.measurement_figure(ctx, measurement_row(handle, cloud_id, mid, "Stack height"))
    spec = fig.snapshot.spec
    assert (spec.kind, spec.subject_kind, spec.subject_id, spec.cloud_id) == (
        "view3d",
        "cloud_measurement",
        mid,
        cloud_id,
    )
    assert fig.caption == f"Stack height: 3D view, captured {blocks.fmt_date(stored.captured_at)}"
    assert _codes(ctx) == {}


def test_a_stale_measurement_view_warns_with_the_cloud_link(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)
    store_measurement_view(handle, cloud_id, mid)
    make_stale(handle, measurement_id=mid)
    ctx = make_ctx(handle)
    cloud.measurement_figure(ctx, measurement_row(handle, cloud_id, mid))
    assert _codes(ctx)[cloud.STALE].link == f"/p/{handle.id}/clouds/{cloud_id}"


def test_no_view_uses_the_dsm_covering_the_centroid(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)  # two points X-5 and X+5: centroid (X, Y)
    sid = insert_surface(handle, cloud_id, bounds=(X - 1.0, Y - 1.0, X + 1.0, Y + 1.0))
    ctx = make_ctx(handle)
    fig = cloud.measurement_figure(ctx, measurement_row(handle, cloud_id, mid))
    assert (fig.snapshot.spec.kind, fig.snapshot.spec.item_id) == ("elevation", sid)
    geom = fig.snapshot.spec.geometry
    # SnapshotGeometry is a pydantic model, not a dict (confirmed: not subscriptable).
    assert geom.type == "Point" and geom.coordinates == [pytest.approx(X), pytest.approx(Y)]
    assert fig.caption == "M1: Plan view of DSM 14 Sep: no 3D view saved"
    assert _codes(ctx)[cloud.MISSING_CODE].link == f"/p/{handle.id}/clouds/{cloud_id}"


def test_an_area_falls_back_to_its_outline(handle, cloud_id):
    ring = [(X, Y), (X + 4, Y), (X + 4, Y + 4), (X, Y + 4)]
    points = [{"x": a, "y": b, "z": Z, "uncertainty_m": 0.01} for a, b in ring]
    mid = cloud_measurement(handle, cloud_id, kind="area", points=points)
    insert_surface(handle, cloud_id)
    fig = cloud.measurement_figure(make_ctx(handle), measurement_row(handle, cloud_id, mid))
    geom = fig.snapshot.spec.geometry
    assert geom.type == "Polygon"
    assert geom.coordinates[0] == [[a, b] for a, b in ring] + [[X, Y]]


def test_no_view_and_no_dsm_is_the_measurement_placeholder(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)
    fig = cloud.measurement_figure(make_ctx(handle), measurement_row(handle, cloud_id, mid))
    assert fig.snapshot.missing_reason == (
        "No 3D view saved. Open this measurement in Point clouds to capture one"
    )
    assert fig.caption == "M1: No 3D view"


def test_a_deleted_measurement_is_a_placeholder_without_a_warning(handle, cloud_id):
    ctx = make_ctx(handle)
    fig = cloud.measurement_figure(ctx, measurement_row(handle, cloud_id, "gone"))
    assert fig.snapshot.missing_reason == "The measurement no longer exists"
    assert _codes(ctx) == {}


def test_a_non_cloud_row_is_a_caller_bug(handle, cloud_id):
    row = measurement_row(handle, cloud_id, "v1").model_copy(update={"kind": "volume"})
    with pytest.raises(ValueError):
        cloud.measurement_figure(make_ctx(handle), row)


def test_fallback_geometry_rules():
    pts = [{"x": 0.0, "y": 0.0, "z": 0.0}, {"x": 2.0, "y": 4.0, "z": 9.0}]
    assert cloud.fallback_geometry("distance", pts) == (
        (1.0, 2.0),
        {"type": "Point", "coordinates": [1.0, 2.0]},
    )
    assert cloud.fallback_geometry("area", pts)[1]["type"] == "Point"  # < 3 vertices: a pin
