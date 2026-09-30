"""R9-I attachment snapshots: a finding photo at print size, bounded (reports spec §9.5, §15, §16).

Alignment (2026-09-30-reports-r9i/alignment.md): `source_version` returns `MISSING + reason`
(`app.reports.snapshots.MISSING`), not bare "missing"; `render` raises `SnapshotUnavailable`
(a `LookupError` subclass), not a plain `LookupError`.
"""

import pytest
from PIL import Image as PILImage
from reports_image_rows import add_photos, image_finding

from app.db.models import FindingAttachment
from app.reports.schemas import AttachmentSpec
from app.reports.snapshots import MISSING, SnapshotUnavailable, attachment

OUT = [480, 360]


def _spec(fid, aid, out=OUT):
    return AttachmentSpec(kind="attachment", finding_id=fid, attachment_id=aid, out=out)


@pytest.fixture
def photo(handle, crack, make_jpeg, tmp_path):
    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    (aid,) = add_photos(handle, f.id, tmp_path, make_jpeg, 1, size=(1200, 600))
    return f.id, aid


def test_a_photo_is_fitted_and_padded_white_to_out(handle, photo):
    im = attachment.render(handle, _spec(*photo))
    assert im.mode == "RGB" and im.size == (480, 360)
    assert im.getpixel((240, 5)) == (255, 255, 255)  # a 2:1 photo in a 4:3 cell: white bands
    assert im.getpixel((240, 180)) != (255, 255, 255)


def test_an_exif_rotated_photo_prints_upright(handle, crack, make_jpeg, tmp_path):
    from app.findings import attachments

    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    src = make_jpeg(tmp_path / "phone.jpg", 600, 300, exif={"orientation": 6})  # stored 2:1, shown 1:2
    aid = attachments.add(handle, f.id, str(src)).id
    im = attachment.render(handle, _spec(f.id, aid))
    # upright 1:2 in 480x360: 180 px wide centred, so the sides are white and the centre is not
    assert im.getpixel((20, 180)) == (255, 255, 255) and im.getpixel((240, 180)) != (255, 255, 255)


def test_a_png_with_alpha_prints_on_white(handle, crack, make_jpeg, tmp_path):
    from app.findings import attachments

    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    src = tmp_path / "clear.png"
    PILImage.new("RGBA", (400, 300), (0, 0, 0, 0)).save(src)
    aid = attachments.add(handle, f.id, str(src)).id
    im = attachment.render(handle, _spec(f.id, aid))
    assert im.mode == "RGB" and im.getpixel((240, 180)) == (255, 255, 255)


def test_a_huge_photo_is_draft_decoded(handle, crack, make_jpeg, tmp_path, monkeypatch):
    from app.findings import attachments

    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    src = tmp_path / "big.jpg"  # flat colour: a small file, but 48 MP to decode
    PILImage.new("RGB", (8000, 6000), (90, 120, 150)).save(src, "JPEG", quality=90)
    aid = attachments.add(handle, f.id, str(src)).id
    decoded = []
    real = attachment.ImageOps.exif_transpose
    monkeypatch.setattr(
        attachment.ImageOps, "exif_transpose", lambda im, **kw: decoded.append(im.size) or real(im, **kw)
    )
    im = attachment.render(handle, _spec(f.id, aid))
    assert im.size == (480, 360)
    # Pillow's pixel buffers are C allocations that tracemalloc cannot see, so the bound is pinned on
    # the decoded size: draft picks 1/8 (1000 x 750, ~2.3 MB) instead of 8000 x 6000 (144 MB).
    assert decoded == [(1000, 750)]


def test_the_same_spec_renders_the_same_pixels(handle, photo):
    a = attachment.render(handle, _spec(*photo))
    b = attachment.render(handle, _spec(*photo))
    assert a.tobytes() == b.tobytes()


def test_source_version_follows_the_file(handle, photo):
    fid, aid = photo
    before = attachment.source_version(handle, _spec(fid, aid))
    with handle.session() as s:
        path = handle.folder / s.get(FindingAttachment, aid).path
    path.write_bytes(path.read_bytes() + b"\0")
    assert attachment.source_version(handle, _spec(fid, aid)) != before


def test_source_version_is_missing_not_an_error(handle, photo):
    fid, aid = photo
    assert attachment.source_version(handle, _spec(fid, "nope")).startswith(MISSING)
    with handle.session() as s:
        (handle.folder / s.get(FindingAttachment, aid).path).unlink()
    assert attachment.source_version(handle, _spec(fid, aid)).startswith(MISSING)


def test_a_missing_file_raises_for_the_placeholder(handle, photo):
    fid, aid = photo
    with handle.session() as s:
        (handle.folder / s.get(FindingAttachment, aid).path).unlink()
    with pytest.raises(SnapshotUnavailable):
        attachment.render(handle, _spec(fid, aid))


def test_an_attachment_of_another_finding_is_refused(handle, crack, make_jpeg, photo):
    other, _, _ = image_finding(handle, crack["id"], make_jpeg, name="b.jpg")
    with pytest.raises(SnapshotUnavailable):
        attachment.render(handle, _spec(other.id, photo[1]))
    assert attachment.source_version(handle, _spec(other.id, photo[1])).startswith(MISSING)


def test_a_path_outside_findings_is_refused(handle, photo, make_jpeg):
    fid, aid = photo
    make_jpeg(handle.folder / "images" / "secret.jpg", 64, 48)
    with handle.session() as s:
        s.get(FindingAttachment, aid).path = "findings/../images/secret.jpg"
    with pytest.raises(SnapshotUnavailable):
        attachment.render(handle, _spec(fid, aid))


def test_an_undecodable_file_becomes_unavailable(handle, photo):
    """A row whose file is not a real image (bomb-guard's sibling case: decode, not header, fails):
    garbage bytes renamed .jpg written directly under the finding's own `findings/<id>/` folder, the
    row re-pointed at it. R3's `render_result` must be able to turn this into a placeholder rather
    than crash, so `render` must convert the decode failure, not let it propagate raw."""
    fid, aid = photo
    with handle.session() as s:
        rel = f"findings/{fid}/garbage.jpg"
        (handle.folder / rel).write_bytes(b"not actually a jpeg" * 50)
        s.get(FindingAttachment, aid).path = rel
    with pytest.raises(SnapshotUnavailable):
        attachment.render(handle, _spec(fid, aid))


def test_an_over_limit_photo_is_refused_even_between_1x_and_2x(
    handle, crack, make_jpeg, tmp_path, monkeypatch
):
    """Pillow's own DecompressionBombError only fires above 2x MAX_IMAGE_PIXELS; between 1x and 2x
    it only warns and still decodes. `render` must refuse it anyway (image_crop.py's own explicit
    pixel-count guard, amendment A11): a photo whose pixel count lands in that 1x-2x band, checked
    against a MAX_IMAGE_PIXELS lowered just for this test."""
    from app.findings import attachments

    f, _, _ = image_finding(handle, crack["id"], make_jpeg)
    src = tmp_path / "big.jpg"
    PILImage.new("RGB", (1000, 900), (10, 20, 30)).save(src, "JPEG", quality=90)  # 900,000 px
    aid = attachments.add(handle, f.id, str(src)).id  # inspected under the real (huge) default limit
    monkeypatch.setattr(attachment.PILImage, "MAX_IMAGE_PIXELS", 800_000)  # 900,000 px is 1.125x this
    with pytest.warns(PILImage.DecompressionBombWarning), pytest.raises(SnapshotUnavailable):
        attachment.render(handle, _spec(f.id, aid))
