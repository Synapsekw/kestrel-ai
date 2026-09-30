"""R9-I photos (reports spec §7.2 `photos_max` 0-6, §7.3 photos 40x30 mm)."""

import pytest
from findings_helpers import insert_cloud
from reports_image_rows import add_photos, image_finding, make_ctx, row_of

from app.findings import service
from app.findings.anchors import AnchorIn
from app.reports.figures import image
from app.reports.snapshots.keys import snapshot_key


def test_the_first_max_n_photos_oldest_first_as_attachment_figures(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    ids = add_photos(handle, f.id, tmp_path, make_jpeg, 5)
    ctx = make_ctx(handle)
    figs = image.photos(ctx, row_of(handle, f.id), 4)
    assert [fig.snapshot.spec.attachment_id for fig in figs] == ids[:4]
    first = figs[0]
    assert first.snapshot.spec.kind == "attachment" and first.snapshot.spec.finding_id == f.id
    assert list(first.snapshot.spec.out) == [480, 360]
    assert (first.snapshot.width_px, first.snapshot.height_px) == (480, 360)
    assert (first.width_mm, first.height_mm) == (40, 30)
    assert first.caption == "photo0.jpg"
    assert first.snapshot.key == snapshot_key(handle, first.snapshot.spec)


@pytest.mark.parametrize(("max_n", "expected"), [(0, 0), (-3, 0), (2, 2), (6, 6), (9, 6)])
def test_max_n_is_clamped_to_0_through_6(handle, crack, make_jpeg, tmp_path, max_n, expected):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_photos(handle, f.id, tmp_path, make_jpeg, 7, size=(64, 48))
    assert len(image.photos(make_ctx(handle), row_of(handle, f.id), max_n)) == expected


def test_a_long_file_name_is_cut_to_32_characters(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    src = make_jpeg(tmp_path / ("x" * 40 + ".jpg"), 64, 48)
    from app.findings import attachments

    attachments.add(handle, f.id, str(src))
    (fig,) = image.photos(make_ctx(handle), row_of(handle, f.id), 4)
    assert fig.caption == "x" * 31 + "…"


def test_photos_work_for_a_cloud_finding_too(handle, crack, make_jpeg, tmp_path):
    cloud = insert_cloud(handle)
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
    )
    add_photos(handle, f.id, tmp_path, make_jpeg, 2, size=(64, 48))
    assert len(image.photos(make_ctx(handle), row_of(handle, f.id), 4)) == 2


def test_no_photos_is_an_empty_list(handle, crack, make_jpeg):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    assert image.photos(make_ctx(handle), row_of(handle, f.id), 4) == []
