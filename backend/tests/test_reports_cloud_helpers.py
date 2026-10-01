"""R9-C helpers: the capture deep link, the covering cloud DSM, aggregated builder warnings."""

from datetime import timedelta

import pytest
from reports_cloud_rows import T0, X, Y, insert_cloud, insert_surface, make_ctx

from app.reports.figures import cloud


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def test_deep_links():
    assert cloud.deep_link("p1", "c1", "f1") == "/p/p1/clouds/c1?finding=f1"
    assert cloud.deep_link("p1", "c1") == "/p/p1/clouds/c1"


def test_a_ready_dsm_of_the_cloud_covering_the_xy_is_found(handle, cloud_id):
    sid = insert_surface(handle, cloud_id)
    assert cloud.covering_surface(handle, cloud_id, X, Y) == (sid, "DSM 14 Sep")


def test_outside_the_bounds_is_not_covered(handle, cloud_id):
    insert_surface(handle, cloud_id)
    assert cloud.covering_surface(handle, cloud_id, X + 51.0, Y) is None
    assert cloud.covering_surface(handle, cloud_id, X, Y - 51.0) is None


def test_only_a_ready_dsm_of_the_same_cloud_covers(handle, cloud_id):
    other = insert_cloud(handle)
    insert_surface(handle, other)
    insert_surface(handle, cloud_id, status="building")
    insert_surface(handle, cloud_id, status="failed")
    insert_surface(handle, None, kind="design")
    insert_surface(handle, None, kind="dem")
    assert cloud.covering_surface(handle, cloud_id, X, Y) is None


def test_the_newest_covering_surface_wins(handle, cloud_id):
    insert_surface(handle, cloud_id, name="old", created_at=T0)
    new = insert_surface(handle, cloud_id, name="new", created_at=T0 + timedelta(days=1))
    assert cloud.covering_surface(handle, cloud_id, X, Y) == (new, "new")


def test_warnings_aggregate_with_the_first_link(handle):
    ctx = make_ctx(handle)
    before = len(ctx.warnings)
    cloud.warn(ctx, cloud.STALE, "/p/p/clouds/c?finding=a")
    (w,) = [w for w in ctx.warnings if w.code == cloud.STALE]
    assert (w.message, w.link) == ("1 3D view is out of date", "/p/p/clouds/c?finding=a")
    cloud.warn(ctx, cloud.STALE, "/p/p/clouds/c?finding=b")
    cloud.warn(ctx, cloud.MISSING_CODE, "/p/p/clouds/c")
    cloud.warn(ctx, cloud.MISSING_CODE, "/p/p/clouds/c?finding=d")
    by_code = {w.code: w for w in ctx.warnings[before:]}
    assert len(ctx.warnings) == before + 2
    assert (by_code[cloud.STALE].message, by_code[cloud.STALE].link) == (
        "2 3D views are out of date",
        "/p/p/clouds/c?finding=a",
    )
    assert by_code[cloud.MISSING_CODE].message == "2 3D views are missing"
