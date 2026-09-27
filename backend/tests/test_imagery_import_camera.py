"""The import stores camera columns, original_name, footprint and a thumbnail (spec §7.2, §7.3)."""

from imagery_camera_helpers import MINI_XMP, dji_jpeg, h20t_xmp
from PIL import Image as PILImage
from sqlalchemy import select

from app.db.models import Image


def _rows(handle):
    with handle.session() as s:
        rows = list(s.execute(select(Image).order_by(Image.path)).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def test_import_stores_camera_columns_and_thumbnails(project_id, handle, import_source, tmp_path):
    folder = tmp_path / "flight"
    dji_jpeg(folder / "DJI_0001.jpg", seed=1)
    dji_jpeg(folder / "oblique" / "DJI_0002.jpg", seed=2, xmp=h20t_xmp())
    dji_jpeg(folder / "DJI_0003.jpg", seed=3, xmp=MINI_XMP, lat=None, lon=None)
    import_source(project_id, folder)
    a, b, c = _rows(handle)
    assert a.original_name == "DJI_0001.jpg" and b.original_name == "oblique/DJI_0002.jpg"
    assert (a.rel_alt, a.gimbal_pitch, a.gimbal_yaw, a.flight_yaw) == (38.40, -89.90, -12.30, -11.60)
    assert a.focal_px == 3666.666504 and (a.orig_w, a.orig_h) == (5280, 3956) and a.camera_model == "M3E"
    assert abs(a.focal_mm - 12.29) < 1e-6 and abs(a.sensor_w_mm - 17.3) < 1e-3
    assert a.footprint_kind == "trapezoid" and len(a.footprint) == 4 and a.metadata_version == 1
    # At -30.4 deg pitch, the H20T frame's top rays land beyond 10*h: wedge, not trapezoid (§7.4).
    assert b.lrf_distance_m == 87.512 and b.footprint_kind == "wedge"
    assert c.footprint_kind == "none" and c.footprint is None and c.gimbal_yaw == -170.5
    assert a.subject_distance_m is None
    for row in (a, b, c):
        thumb = handle.thumbs_dir / f"{row.id}.jpg"
        with PILImage.open(thumb) as im:
            assert max(im.size) == 256


def test_non_dji_frames_import_with_exif_only(project_id, handle, import_source, tmp_path):
    folder = tmp_path / "phone"
    dji_jpeg(folder / "IMG_1.jpg", xmp=None, model="Pixel 8")
    import_source(project_id, folder)
    (row,) = _rows(handle)
    assert row.rel_alt is None and row.gimbal_pitch is None and row.camera_model == "Pixel 8"
    assert row.footprint_kind == "point" and row.metadata_version == 1


def test_duplicate_frames_leave_no_thumbnail(project_id, handle, import_source, tmp_path):
    folder = tmp_path / "dup"
    folder.mkdir()
    gradient = PILImage.linear_gradient("L").rotate(20).convert("RGB").resize((640, 480))
    gradient.save(folder / "A_0001.jpg", "JPEG", quality=95)
    gradient.save(folder / "A_0002.jpg", "JPEG", quality=70)  # near duplicate (test_import.py's recipe)
    import_source(project_id, folder)
    rows = _rows(handle)
    assert len(rows) == 1
    assert sorted(p.stem for p in handle.thumbs_dir.glob("*.jpg")) == [rows[0].id]
