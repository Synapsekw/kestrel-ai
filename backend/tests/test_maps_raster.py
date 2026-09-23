import numpy as np
import pytest
import rasterio
from geotiffs import make_geotiff

from app.jobs.cancellation import JobCancelled
from app.maps import raster


def _noop(*_a, **_k):
    return None


def test_inspect_utm(tmp_path):
    info = raster.inspect_raster(make_geotiff(tmp_path / "a.tif", 300, 200))
    assert (info.width, info.height, info.band_count, info.dtype) == (300, 200, 3, "uint8")
    assert info.epsg == 32633 and "+proj=utm" in info.proj4
    assert info.geotransform == pytest.approx((500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03))


def test_inspect_without_coordinates(tmp_path):
    info = raster.inspect_raster(make_geotiff(tmp_path / "plain.tif", 64, 64, crs=None))
    assert info.crs_wkt is None and info.epsg is None and info.geotransform is None


def test_inspect_rejects_a_non_raster(tmp_path):
    bad = tmp_path / "bad.tif"
    bad.write_text("not a tiff")
    with pytest.raises(raster.RasterError, match="not a readable raster"):
        raster.inspect_raster(bad)


def test_stretch_uint8_is_identity_and_uint16_uses_percentiles(tmp_path):
    with rasterio.open(make_geotiff(tmp_path / "a.tif", 64, 64)) as src:
        s = raster.compute_stretch(src)
    assert s.bands == (1, 2, 3) and s.lo == (0.0, 0.0, 0.0) and s.hi == (255.0, 255.0, 255.0)
    with rasterio.open(make_geotiff(tmp_path / "b.tif", 64, 64, count=4, dtype="uint16")) as src:
        s16 = raster.compute_stretch(src)
    assert s16.bands == (1, 2, 3)
    assert all(0 < lo < hi < 4000 for lo, hi in zip(s16.lo, s16.hi, strict=True))
    assert raster.Stretch.from_dict(s16.to_dict()) == s16


def test_apply_stretch_clips_to_uint8():
    s = raster.Stretch((1, 2, 3), (100.0, 100.0, 100.0), (200.0, 200.0, 200.0))
    data = np.array([[[50, 150, 250]]] * 3, dtype=np.uint16)
    assert raster.apply_stretch(data, s)[0, 0].tolist() == [0, 127, 255]


def test_overview_factors():
    assert raster.overview_factors(200, 100) == []
    assert raster.overview_factors(2048, 1000) == [2, 4, 8]


def test_write_display_raster_is_tiled_with_overviews_and_mask(tmp_path):
    src = make_geotiff(tmp_path / "a.tif", 2100, 1100, alpha_border=0.1)
    dst = tmp_path / "out" / "map.tif"
    dst.parent.mkdir()
    seen = []
    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    raster.write_display_raster(
        src, dst, stretch, progress=lambda f, m: seen.append(f), check_cancelled=_noop
    )
    with rasterio.open(dst) as out:
        assert (out.width, out.height, out.count, out.dtypes[0]) == (2100, 1100, 3, "uint8")
        assert out.block_shapes[0] == (512, 512)
        assert out.overviews(1) == [2, 4, 8]
        assert out.crs.to_epsg() == 32633
        rgb, valid = raster.read_rgb(out, 0, 0, 2100, 1100, 210, 110)
    assert rgb.shape == (110, 210, 3) and valid.shape == (110, 210)
    assert not valid[:, :15].any() and valid[:, 30:180].all()  # the 10 % alpha border is masked
    assert seen and seen == sorted(seen)
    assert not (tmp_path / "out" / "map.tif.partial").exists()


def test_write_display_raster_cancel_leaves_nothing(tmp_path):
    src = make_geotiff(tmp_path / "a.tif", 2100, 1100)
    dst = tmp_path / "map.tif"

    def cancel():
        raise JobCancelled()

    with rasterio.open(src) as s:
        stretch = raster.compute_stretch(s)
    with pytest.raises(JobCancelled):
        raster.write_display_raster(src, dst, stretch, progress=_noop, check_cancelled=cancel)
    assert not dst.exists() and not (tmp_path / "map.tif.partial").exists()


def test_low_res_mask_is_bounded(tmp_path):
    with rasterio.open(make_geotiff(tmp_path / "a.tif", 3000, 1000, alpha_border=0.1)) as src:
        mask, scale = raster.low_res_mask(src, max_side=300)
    assert mask.shape == (100, 300) and scale == pytest.approx(0.1)
    assert not mask[:, :25].any() and mask[:, 40:260].all()


def test_preview(tmp_path):
    from PIL import Image

    with rasterio.open(make_geotiff(tmp_path / "a.tif", 3000, 1000)) as src:
        raster.write_preview(src, tmp_path / "p.jpg", max_side=300)
    with Image.open(tmp_path / "p.jpg") as im:
        assert im.size == (300, 100)
