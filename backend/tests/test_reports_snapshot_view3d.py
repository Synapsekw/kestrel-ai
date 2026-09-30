"""R9-C view3d renderer: C's stored view passed through (reports spec §9.1, §9.4)."""

import io

import pytest
from PIL import Image as PILImage
from reports_cloud_rows import (
    cloud_finding,
    cloud_measurement,
    insert_cloud,
    store_finding_view,
    store_measurement_view,
)

from app.reports.schemas import View3dSpec
from app.reports.snapshots import MISSING, view3d
from app.reports.snapshots.keys import snapshot_key


def _spec(kind, sid, cloud_id):
    return View3dSpec(kind="view3d", subject_kind=kind, subject_id=sid, cloud_id=cloud_id)


def _rgba_png(colour=(10, 200, 30, 0)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGBA", (1600, 1000), colour).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def test_source_version_is_the_stored_sha256(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    stored = store_finding_view(handle, f.id)
    assert view3d.source_version(handle, _spec("finding", f.id, cloud_id)) == stored.sha256


def test_source_version_without_a_view_is_missing_with_a_reason(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    sv = view3d.source_version(handle, _spec("finding", f.id, cloud_id))
    assert sv.startswith(MISSING)
    assert sv == MISSING + view3d.NO_VIEW["finding"]


def test_source_version_when_the_finding_is_gone_says_so(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    from app.findings import service

    service.delete_finding(handle, f.id)
    sv = view3d.source_version(handle, _spec("finding", f.id, cloud_id))
    assert sv == MISSING + "The finding no longer exists"


def test_source_version_when_the_measurement_is_gone_says_so(handle, cloud_id):
    from app.db.models import CloudMeasurement

    mid = cloud_measurement(handle, cloud_id)
    with handle.session() as s:
        s.delete(s.get(CloudMeasurement, mid))
    sv = view3d.source_version(handle, _spec("cloud_measurement", mid, cloud_id))
    assert sv == MISSING + "The measurement no longer exists"


def test_the_key_changes_when_the_view_is_recaptured(handle, crack, cloud_id):
    from cloud_views import jpeg

    f = cloud_finding(handle, crack["id"], cloud_id)
    spec = _spec("finding", f.id, cloud_id)
    missing = snapshot_key(handle, spec)
    store_finding_view(handle, f.id)
    first = snapshot_key(handle, spec)
    store_finding_view(handle, f.id, jpeg())
    assert len({missing, first, snapshot_key(handle, spec)}) == 3


def test_render_passes_a_png_view_through_at_print_size(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)  # cloud_views.png(): solid (40, 90, 160)
    im = view3d.render(handle, _spec("finding", f.id, cloud_id))
    assert (im.mode, im.size) == ("RGB", view3d.OUT)
    assert im.getpixel((800, 500)) == (40, 90, 160)


def test_render_flattens_alpha_on_white(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id, _rgba_png())
    im = view3d.render(handle, _spec("finding", f.id, cloud_id))
    assert im.getpixel((0, 0)) == (255, 255, 255)


def test_render_reads_a_measurement_view(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)
    store_measurement_view(handle, cloud_id, mid)
    im = view3d.render(handle, _spec("cloud_measurement", mid, cloud_id))
    assert im.size == view3d.OUT


def test_a_vanished_view_raises_lookup_error(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    stored = store_finding_view(handle, f.id)
    assert stored.sha256
    from app.pointclouds import views

    views.remove_files(handle, cloud_id, "finding", f.id)
    with pytest.raises(LookupError, match="No 3D view saved"):
        view3d.render(handle, _spec("finding", f.id, cloud_id))


def test_a_view_of_another_size_is_fitted_never_enlarged(handle, crack, cloud_id):
    """C validates 1600x1000 at upload; a file changed on disk later must still stay bounded."""
    f = cloud_finding(handle, crack["id"], cloud_id)
    store_finding_view(handle, f.id)
    from app.pointclouds import views

    path = views.stored_view(handle, "finding", f.id).path
    PILImage.new("RGB", (3200, 1000), (1, 2, 3)).save(path, "PNG")
    im = view3d.render(handle, _spec("finding", f.id, cloud_id))
    assert im.size == view3d.OUT
    assert im.getpixel((800, 0)) == (255, 255, 255)  # letterboxed on white, 1600x500 content
    assert im.getpixel((800, 500)) == (1, 2, 3)
