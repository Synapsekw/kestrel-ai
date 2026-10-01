"""R9-I end to end: finding_pages carries the image crop, photos and comments; every figure renders
through the cache at its size; the preview endpoint serves them (reports spec §7.3, §9.5, §17)."""

from io import BytesIO

from PIL import Image as PILImage
from reports_image_rows import add_comments, add_photos, image_finding, make_ctx

from app.db.models import FindingAttachment
from app.reports.compose import SECTION_COMPOSERS
from app.reports.snapshots.keys import encode_spec
from app.reports.snapshots.render import render_result, render_to_cache

API = "/api/v1"


def _finding_block(handle, **options):
    doc = SECTION_COMPOSERS["finding_pages"](make_ctx(handle, **options))
    (block,) = [b for b in doc.blocks if b.kind == "finding"]
    return block


def test_a_finding_page_has_the_crop_photos_and_comments(handle, crack, make_jpeg, tmp_path):
    f, image_id, _ = image_finding(handle, crack["id"], make_jpeg)
    add_photos(handle, f.id, tmp_path, make_jpeg, 5)
    add_comments(handle, f.id, 3)
    block = _finding_block(handle, photos_max=4, comments="all")
    assert block.finding_id == f.id
    assert [fig.snapshot.spec.kind for fig in block.figures] == ["image_crop"]
    assert block.figures[0].snapshot.spec.image_id == image_id
    assert len(block.photos) == 4
    assert [c.text for c in block.comments] == ["c0", "c1", "c2"]


def test_photos_off_and_comments_off(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_photos(handle, f.id, tmp_path, make_jpeg, 2)
    add_comments(handle, f.id, 2)
    block = _finding_block(handle, photos_max=0, comments="none")
    assert block.photos == [] and block.comments == []


def test_every_figure_renders_at_its_size_and_twice_the_same(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_photos(handle, f.id, tmp_path, make_jpeg, 2)
    block = _finding_block(handle, photos_max=4)
    for fig in [*block.figures, *block.photos]:
        path = render_to_cache(handle, fig.snapshot.spec)
        with PILImage.open(path) as im:
            assert im.size == (fig.snapshot.width_px, fig.snapshot.height_px)
        first = path.read_bytes()
        path.unlink()
        assert render_to_cache(handle, fig.snapshot.spec).read_bytes() == first  # byte-stable


def test_a_deleted_photo_renders_a_placeholder(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    (aid,) = add_photos(handle, f.id, tmp_path, make_jpeg, 1)
    (photo,) = _finding_block(handle, photos_max=4).photos
    with handle.session() as s:
        (handle.folder / s.get(FindingAttachment, aid).path).unlink()
    result = render_result(handle, photo.snapshot.spec)  # R3: never raises on one snapshot
    assert result.missing_reason is not None
    with PILImage.open(result.path) as im:
        assert im.size == (480, 360)


def test_the_inset_changes_the_crop_and_reads_the_thumbnail(handle, crack, make_jpeg, monkeypatch):
    from app.datasets import images

    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    with_inset = _finding_block(handle, context_inset=True).figures[0].snapshot
    without = _finding_block(handle, context_inset=False).figures[0].snapshot
    assert with_inset.key != without.key
    calls = []
    real = images.thumbnail
    monkeypatch.setattr(images, "thumbnail", lambda h, i: calls.append(i) or real(h, i))
    a = render_to_cache(handle, with_inset.spec).read_bytes()
    b = render_to_cache(handle, without.spec).read_bytes()
    assert a != b and calls  # §9.2 step 5: the inset comes from the thumbnail, never the original


def test_the_preview_endpoint_serves_a_photo(client, handle, project_id, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    add_photos(handle, f.id, tmp_path, make_jpeg, 1)
    (photo,) = _finding_block(handle, photos_max=4).photos
    r = client.get(
        f"{API}/projects/{project_id}/report-snapshots/{photo.snapshot.key}",
        params={"spec": encode_spec(photo.snapshot.spec)},
    )
    assert (r.status_code, r.headers["content-type"]) == (200, "image/jpeg")
    assert "x-snapshot-missing" not in r.headers  # a real photo is never served as missing
    assert PILImage.open(BytesIO(r.content)).size == (480, 360)
