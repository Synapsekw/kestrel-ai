"""R9-C end to end: finding_pages carries the cloud figure, the cache holds a q88 passthrough, the
placeholder and the hillshade render, and the preview endpoint serves the view (spec §9.4, §9.5)."""

import io

import pytest
from cloud_views import jpeg
from PIL import Image as PILImage
from reports_cloud_rows import cloud_finding, insert_cloud, insert_surface, make_ctx, store_finding_view

from app.pointclouds import views
from app.reports.compose import SECTION_COMPOSERS
from app.reports.figures import cloud
from app.reports.snapshots import cache, view3d
from app.reports.snapshots.keys import encode_spec
from app.reports.snapshots.render import render_to_cache

BASE = "/api/v1/projects"


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _finding_block(handle, ctx=None):
    ctx = ctx or make_ctx(handle)
    doc = SECTION_COMPOSERS["finding_pages"](ctx)
    (block,) = [b for b in doc.blocks if b.kind == "finding"]
    return block


def test_a_cloud_finding_page_carries_its_view(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    block = _finding_block(handle)
    assert block.finding_id == f.id
    assert [fig.snapshot.spec.kind for fig in block.figures] == ["view3d"]


def test_the_cache_holds_a_q88_passthrough(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    fig = _finding_block(handle).figures[0]
    path = render_to_cache(handle, fig.snapshot.spec)
    img = view3d.render(handle, fig.snapshot.spec)
    expected = cache.encode_jpeg(img, view3d.JPEG_QUALITY)
    assert path.read_bytes() == expected
    first = path.read_bytes()
    path.unlink()
    assert render_to_cache(handle, fig.snapshot.spec).read_bytes() == first  # byte-stable


def test_a_vanished_view_renders_a_placeholder(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    fig = _finding_block(handle).figures[0]
    views.remove_files(handle, cloud_id, "finding", f.id)
    path = render_to_cache(handle, fig.snapshot.spec)  # R3: never raises on one snapshot
    with PILImage.open(path) as im:
        assert im.size == view3d.OUT


def test_the_placeholder_and_the_hillshade_render(handle, crack, cloud_id):
    cloud_finding(handle, crack["id"], cloud_id)
    placeholder = _finding_block(handle).figures[0]
    with PILImage.open(render_to_cache(handle, placeholder.snapshot.spec)) as im:
        assert im.size == view3d.OUT
    insert_surface(handle, cloud_id)
    plan = _finding_block(handle).figures[0]
    assert plan.snapshot.spec.kind == "elevation"
    with PILImage.open(render_to_cache(handle, plan.snapshot.spec)) as im:
        assert im.size == cloud.PLAN_OUT  # R3 renders a placeholder: the fixture surface has no tif


def test_the_builder_sees_the_stale_warning(handle, crack, cloud_id):
    from reports_cloud_rows import make_stale

    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    make_stale(handle, finding_id=f.id)
    ctx = make_ctx(handle)
    _finding_block(handle, ctx)
    assert any(w.code == cloud.STALE and w.message == "1 3D view is out of date" for w in ctx.warnings)


def test_the_preview_endpoint_serves_the_view(client, handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    fig = _finding_block(handle).figures[0]
    url = f"{BASE}/{handle.id}/report-snapshots/{fig.snapshot.key}?spec={encode_spec(fig.snapshot.spec)}"
    r = client.get(url)
    assert (r.status_code, r.headers["content-type"]) == (200, "image/jpeg")
    assert PILImage.open(io.BytesIO(r.content)).size == view3d.OUT


def test_a_recaptured_view_serves_the_new_image(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    fig1 = _finding_block(handle).figures[0]
    first = render_to_cache(handle, fig1.snapshot.spec).read_bytes()

    store_finding_view(handle, f.id, data=jpeg())
    fig2 = _finding_block(handle).figures[0]
    assert fig2.snapshot.key != fig1.snapshot.key
    second = render_to_cache(handle, fig2.snapshot.spec).read_bytes()
    assert second != first
