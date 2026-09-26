"""DEM inspection (spec §6 Inspect, §15.3 DEM)."""

import numpy as np
import pytest
from design_targets import write_dem
from designs import E0, N0
from PIL import Image

from app.jobs.cancellation import JobFailure
from app.surfaces.design import dem, store


def read(path, tmp_path):
    idir = tmp_path / "insp"
    idir.mkdir(exist_ok=True)
    res = dem.inspect_file(path, idir, progress=lambda f, m: None, check_cancelled=lambda: None)
    return res, idir


def ramp(h=300, w=400, lo=10.0):
    return (lo + np.arange(w)[None, :] * 0.01 + np.arange(h)[:, None] * 0.02).astype(np.float32)


def test_a_float_dem_with_declared_nodata(tmp_path):
    z = ramp()
    z[:10] = -9999
    src = write_dem(tmp_path / "d.tif", z, x0=E0, y0=N0 + 300, cell=1.0, nodata=-9999)
    res, idir = read(src, tmp_path)
    (c,) = res.candidates
    assert (c.id, c.kind, c.name, c.geometry, c.default_selected) == ("c0", "dem", "band 1", "raster", True)
    assert c.raster == {
        "width": 400,
        "height": 300,
        "cell_x": 1.0,
        "cell_y": 1.0,
        "dtype": "float32",
        "nodata": -9999.0,
        "band_count": 1,
    }
    assert c.bounds_file == [E0, N0, E0 + 400, N0 + 300]
    assert c.z_min == pytest.approx(10.2, abs=0.05) and c.notes == []
    assert res.detected.epsg == 32639 and res.detected.crs_source == "GeoTIFF CRS"
    assert res.detected.horizontal_unit is None and res.detected.vertical_unit == "metre"
    assert res.internal == {
        "nodata": -9999.0,
        "sentinel": False,
        "mask": False,
        "scale": 1.0,
        "offset": 0.0,
        "rotated": False,
    }
    im = Image.open(store.thumb_path(idir, "c0"))
    assert max(im.size) == 160


def test_int16_with_minus_32767_nodata(tmp_path):
    z = (ramp() * 10).astype(np.int16)
    z[:, :5] = -32767
    res, _ = read(
        write_dem(tmp_path / "i.tif", z, x0=E0, y0=N0 + 300, cell=1.0, dtype="int16", nodata=-32767), tmp_path
    )
    assert res.candidates[0].raster["dtype"] == "int16" and res.internal["nodata"] == -32767.0
    assert res.candidates[0].z_min > 0


def test_a_nan_nodata_is_reported_as_none(tmp_path):
    z = ramp()
    z[:5] = np.nan
    res, _ = read(write_dem(tmp_path / "nan.tif", z, x0=E0, y0=N0 + 300, cell=1.0, nodata=np.nan), tmp_path)
    c = res.candidates[0]
    assert c.raster["nodata"] is None and res.internal["nodata"] is None and c.notes == []


def test_an_undeclared_minus_9999_sentinel_is_proposed(tmp_path):
    z = ramp()
    z[:, :20] = -9999
    res, _ = read(write_dem(tmp_path / "s.tif", z, x0=E0, y0=N0 + 300, cell=1.0), tmp_path)
    c = res.candidates[0]
    assert [n.code for n in c.notes] == ["sentinel_nodata"] and c.notes[0].level == "warn"
    assert res.internal["sentinel"] is True and res.internal["nodata"] == -9999.0
    assert c.raster["nodata"] == -9999.0 and c.z_min > 0


def test_no_nodata_at_all_is_an_info(tmp_path):
    res, _ = read(write_dem(tmp_path / "n.tif", ramp(), x0=E0, y0=N0 + 300, cell=1.0), tmp_path)
    assert [(n.code, n.level) for n in res.candidates[0].notes] == [("nodata_unknown", "info")]


def test_scale_and_offset_are_applied(tmp_path):
    z = (ramp() * 100).astype(np.int16)
    res, _ = read(
        write_dem(
            tmp_path / "so.tif", z, x0=E0, y0=N0 + 300, cell=1.0, dtype="int16", scale=0.01, offset=-50.0
        ),
        tmp_path,
    )
    assert res.internal["scale"] == 0.01 and res.internal["offset"] == -50.0
    assert res.candidates[0].z_min == pytest.approx(10.0 - 50.0, abs=0.05)  # raw 1000 x 0.01 - 50


def test_an_rgb_image_is_sent_to_maps(tmp_path):
    rgb = np.zeros((3, 50, 50), np.uint8)
    src = write_dem(tmp_path / "o.tif", rgb, x0=E0, y0=N0 + 50, cell=1.0, dtype="uint8", count=3)
    with pytest.raises(
        JobFailure,
        match="this is an image \\(an orthomosaic\\?\\), not a height model — import it under Maps",
    ):
        read(src, tmp_path)


def test_no_georeferencing_is_refused(tmp_path):
    src = write_dem(tmp_path / "g.tif", ramp(), x0=0, y0=0, cell=1.0, crs=None, identity=True)
    with pytest.raises(JobFailure, match="no georeferencing"):
        read(src, tmp_path)


def test_a_rotated_geotransform_is_accepted(tmp_path):
    res, _ = read(
        write_dem(tmp_path / "r.tif", ramp(), x0=E0, y0=N0 + 300, cell=1.0, rotation=10.0), tmp_path
    )
    c = res.candidates[0]
    assert res.internal["rotated"] is True and c.raster["cell_x"] == pytest.approx(1.0)
    minx, miny, maxx, maxy = c.bounds_file
    assert maxx - minx > 400 and maxy - miny > 300  # the envelope of the rotated corners


def test_feet_heights_in_a_feet_crs_default_to_feet(tmp_path):
    res, _ = read(
        write_dem(tmp_path / "ft.tif", ramp(), x0=6_000_000, y0=2_000_300, cell=3.0, crs="EPSG:2229"),
        tmp_path,
    )
    assert res.detected.vertical_unit == "us_survey_foot"
