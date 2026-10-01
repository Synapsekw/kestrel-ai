"""S1-U3 classifier on real, tiny fixtures (spec §12 "The classifier on small fixtures") and the
proofs that the real reader reads headers only: no pixels, no points, no XML beyond 64 KiB."""

import pytest
from drawings_helpers import write_landxml, write_pdf
from geotiffs import make_geotiff
from imagery_camera_helpers import M3E_XMP, dji_jpeg
from pointclouds import make_las
from setup_inspect_helpers import THERMAL_XMP, VISUAL_XMP

from app.setup import classify as cl
from app.setup.classify import RealHeaderReader, classify

READER = RealHeaderReader()
SMALL = (64, 48)


def test_three_band_uint8_geotiff_is_an_orthomosaic(tmp_path):
    got = classify(make_geotiff(tmp_path / "ortho.tif", 64, 48), READER)
    assert (got.route, got.match, got.crs) == ("map", {"raster": "ortho"}, "EPSG:32633")


def test_three_band_uint16_geotiff_is_an_orthomosaic(tmp_path):
    """Review focus 2: a 16-bit export is still a map, never elevation or Not recognised."""
    got = classify(make_geotiff(tmp_path / "multispectral.tif", 64, 48, dtype="uint16"), READER)
    assert (got.route, got.match, got.reason) == ("map", {"raster": "ortho"}, None)


def test_one_band_float_geotiff_is_elevation(tmp_path):
    got = classify(make_geotiff(tmp_path / "dsm.tif", 64, 48, count=1, dtype="float32"), READER)
    assert (got.route, got.match, got.crs) == ("elevation", {"raster": "elevation"}, "EPSG:32633")


def test_one_band_int16_geotiff_is_elevation(tmp_path):
    got = classify(make_geotiff(tmp_path / "dtm.tiff", 64, 48, count=1, dtype="int16"), READER)
    assert got.route == "elevation"


def test_a_tiff_without_coordinates_is_a_photo(tmp_path):
    got = classify(make_geotiff(tmp_path / "IMG_0001.tif", 64, 48, crs=None), READER)
    assert (got.route, got.match) == ("images", {"thermal": False})


def test_a_dji_visual_and_thermal_pair(tmp_path):
    visual = dji_jpeg(tmp_path / "DJI_20260930101500_0001_V.JPG", size=SMALL, xmp=VISUAL_XMP)
    thermal = dji_jpeg(tmp_path / "DJI_20260930101500_0001_T.JPG", size=SMALL, xmp=THERMAL_XMP)
    assert classify(visual, READER).match == {"thermal": False}
    assert classify(thermal, READER).match == {"thermal": True}


def test_the_xmp_says_thermal_when_the_name_does_not(tmp_path):
    renamed = dji_jpeg(tmp_path / "IMG_0001.JPG", size=SMALL, xmp=THERMAL_XMP)
    plain = dji_jpeg(tmp_path / "IMG_0002.JPG", size=SMALL, xmp=M3E_XMP)  # no ImageSource
    no_xmp = dji_jpeg(tmp_path / "IMG_0003.JPG", size=SMALL, xmp=None)
    assert READER.image_meta(renamed).thermal is True
    assert READER.image_meta(plain).thermal is None
    assert READER.image_meta(no_xmp).thermal is None
    assert classify(renamed, READER).match == {"thermal": True}
    assert classify(plain, READER).match == {"thermal": False}


def test_a_las_is_a_point_cloud_with_its_crs(tmp_path):
    got = classify(make_las(tmp_path / "scan.las", 100, epsg=32639), READER)
    assert (got.route, got.crs) == ("pointcloud", "EPSG:32639")
    assert classify(make_las(tmp_path / "bare.las", 10, epsg=None), READER).crs is None


def test_pdf_dxf_and_landxml_are_drawings(tmp_path):
    pdf = write_pdf(tmp_path / "plan.pdf", [(595.0, 842.0)])
    dxf = tmp_path / "site.dxf"
    dxf.write_text("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n", "ascii")
    landxml = write_landxml(tmp_path / "design.xml", "")
    assert [classify(f, READER).route for f in (pdf, dxf, landxml)] == ["drawing"] * 3


def test_an_xml_that_is_not_landxml(tmp_path):
    gpx = tmp_path / "flight.xml"
    gpx.write_text('<?xml version="1.0"?><gpx version="1.1"><trk/></gpx>', "utf-8")
    assert (classify(gpx, READER).route, classify(gpx, READER).reason) == (None, cl.NOT_LANDXML)


def test_the_xml_root_is_read_from_the_first_64_kib_only(tmp_path):
    """Bounded: a root element hidden behind 70 KiB of comment is not looked for."""
    late = tmp_path / "late.xml"
    late.write_text('<?xml version="1.0"?><!--' + "x" * 70_000 + "--><LandXML/>", "utf-8")
    assert READER.xml_root(late) is None
    assert classify(late, READER).reason == cl.NOT_LANDXML


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("broken.tif", b"II*\x00 this is not a tiff"),
        ("broken.jpg", b"this is not a jpeg"),
        ("broken.las", b"LASF" + b"\x00" * 16),
        ("broken.xml", b"<<< not xml"),
    ],
)
def test_a_broken_header_is_not_recognised(tmp_path, name, content):
    path = tmp_path / name
    path.write_bytes(content)
    got = classify(path, READER)
    assert (got.route, got.reason) == (None, cl.UNREADABLE)


def test_image_meta_never_decodes_pixels(tmp_path, monkeypatch):
    from PIL import ImageFile, JpegImagePlugin

    def no_pixels(*_a, **_k):
        raise AssertionError("pixels were decoded")

    photo = dji_jpeg(tmp_path / "DJI_20260930101500_0001_T.JPG", size=SMALL, xmp=THERMAL_XMP)
    monkeypatch.setattr(ImageFile.ImageFile, "load", no_pixels)
    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "load", no_pixels, raising=False)
    assert READER.image_meta(photo).thermal is True


def test_the_las_header_never_reads_points(tmp_path, monkeypatch):
    import laspy

    def no_points(*_a, **_k):
        raise AssertionError("points were read")

    cloud = make_las(tmp_path / "scan.las", 100)
    monkeypatch.setattr(laspy.LasReader, "read", no_points)
    monkeypatch.setattr(laspy.LasReader, "read_points", no_points)
    assert classify(cloud, READER).route == "pointcloud"
