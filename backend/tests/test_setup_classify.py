"""S1-U3 classifier rules (spec 2026-09-30-project-setup §7.2) over a counting fake reader: every
route, every reason, and exactly which header each rule reads."""

from pathlib import Path

import pytest
from imagery_camera_helpers import M3E_XMP
from setup_inspect_helpers import THERMAL_XMP, VISUAL_XMP, CountingReader

from app.datasets.prepare import parse_xmp, xmp_fields
from app.setup import classify as cl
from app.setup.classify import ImageMeta, LasHeader, RasterHeader, classify, lens_of
from app.surfaces.design.detect import DWG_MESSAGE

HERE = Path("E:/delivery")  # never opened: the fake answers every read


def p(name: str) -> Path:
    return HERE / name


@pytest.mark.parametrize(
    ("header", "route", "match"),
    [
        (RasterHeader(3, "uint8", True, "EPSG:32633"), "map", {"raster": "ortho"}),
        (RasterHeader(4, "uint8", True, "EPSG:32633"), "map", {"raster": "ortho"}),
        (RasterHeader(3, "uint16", True, "EPSG:32633"), "map", {"raster": "ortho"}),
        (RasterHeader(1, "uint8", True, "EPSG:32633"), "map", {"raster": "ortho"}),
        (RasterHeader(2, "uint8", True, "EPSG:32633"), "map", {"raster": "ortho"}),
        (RasterHeader(1, "float32", True, "EPSG:32633"), "elevation", {"raster": "elevation"}),
        (RasterHeader(1, "float64", True, "EPSG:32633"), "elevation", {"raster": "elevation"}),
        (RasterHeader(1, "int16", True, "EPSG:32633"), "elevation", {"raster": "elevation"}),
        (RasterHeader(1, "uint16", True, "EPSG:32633"), "elevation", {"raster": "elevation"}),
        (RasterHeader(3, "uint8", False, None), "images", {"thermal": False}),
        (RasterHeader(1, "uint16", False, None), "images", {"thermal": False}),
    ],
)
def test_raster_rules(header, route, match):
    reader = CountingReader(raster=header)
    got = classify(p("site.tif"), reader)
    assert (got.route, got.match, got.reason) == (route, match, None)
    assert reader.calls == {"raster": 1}


def test_a_raster_keeps_its_crs_and_a_tiff_photo_follows_its_name():
    assert classify(p("ortho.TIFF"), CountingReader()).crs == "EPSG:32633"
    photo = classify(p("DJI_0001_T.TIF"), CountingReader(raster=RasterHeader(1, "uint16", False, None)))
    assert (photo.route, photo.match, photo.crs) == ("images", {"thermal": True}, None)


@pytest.mark.parametrize(
    ("name", "meta", "thermal"),
    [
        ("DJI_20260930101500_0001_T.JPG", ImageMeta(thermal=None), True),
        ("DJI_20260930101500_0001_V.JPG", ImageMeta(thermal=None), False),
        ("DJI_20260930101500_0001_W.jpeg", ImageMeta(thermal=None), False),
        ("DJI_20260930101500_0001_V.JPG", ImageMeta(thermal=True), True),  # the XMP wins
        ("IMG_0001.JPG", ImageMeta(thermal=True), True),
        ("IMG_0001.JPG", ImageMeta(thermal=False), False),
        ("IMG_0001.JPG", ImageMeta(thermal=None), False),
    ],
)
def test_a_sampled_photo_reads_one_header(name, meta, thermal):
    reader = CountingReader(image=meta)
    got = classify(p(name), reader)
    assert (got.route, got.match) == ("images", {"thermal": thermal})
    assert reader.calls == {"image_meta": 1}


@pytest.mark.parametrize(
    ("name", "default", "thermal"),
    [
        ("DJI_20260930101500_0021_T.JPG", False, True),
        ("DJI_20260930101500_0021_Z.JPG", True, False),  # a lens suffix beats the folder default
        ("IMG_0021.JPG", True, True),
        ("IMG_0021.JPG", False, False),
    ],
)
def test_an_unsampled_photo_follows_its_name_then_the_folder(name, default, thermal):
    reader = CountingReader()
    got = classify(p(name), reader, read_header=False, thermal_default=default)
    assert (got.route, got.match) == ("images", {"thermal": thermal})
    assert reader.calls == {}


@pytest.mark.parametrize("name", ["plan.png", "frame.BMP", "shot.webp"])
def test_other_photos_need_no_header(name):
    reader = CountingReader()
    assert classify(p(name), reader).route == "images"
    assert reader.calls == {}


def test_a_cloud_reads_one_las_header_and_keeps_its_crs():
    reader = CountingReader(las=LasHeader(crs="EPSG:32639"))
    for name in ("scan.las", "scan.LAZ"):
        got = classify(p(name), reader)
        assert (got.route, got.match, got.crs) == ("pointcloud", {}, "EPSG:32639")
    assert reader.calls == {"las": 2}


def test_pdf_and_dxf_are_drawings_without_a_read():
    reader = CountingReader()
    assert [classify(p(n), reader).route for n in ("plan.pdf", "site.DXF")] == ["drawing", "drawing"]
    assert reader.calls == {}


@pytest.mark.parametrize(
    ("root", "route", "reason"),
    [("LandXML", "drawing", None), ("gpx", None, cl.NOT_LANDXML), (None, None, cl.NOT_LANDXML)],
)
def test_xml_is_a_drawing_only_when_its_root_is_landxml(root, route, reason):
    reader = CountingReader(xml_root=root)
    got = classify(p("design.xml"), reader)
    assert (got.route, got.reason) == (route, reason)
    assert reader.calls == {"xml_root": 1}


def test_video_is_coming_until_s4_flips_one_line(monkeypatch):
    reader = CountingReader()
    for name in ("flight.mp4", "flight.MOV"):
        got = classify(p(name), reader)
        assert (got.route, got.reason) == (None, cl.VIDEO_COMING)
    monkeypatch.setattr(cl, "VIDEO_IMPORT_ENABLED", True)
    assert classify(p("flight.mp4"), reader).route == "video"
    assert reader.calls == {}


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("Thumbs.db", cl.UNKNOWN),
        ("notes.txt", cl.UNKNOWN),
        ("no_extension", cl.UNKNOWN),
        ("raw.DNG", cl.DNG_NOT_IMPORTED),
        ("site.dwg", DWG_MESSAGE),
    ],
)
def test_not_recognised_with_a_reason_and_no_read(name, reason):
    reader = CountingReader()
    got = classify(p(name), reader)
    assert (got.route, got.reason) == (None, reason)
    assert reader.calls == {}


@pytest.mark.parametrize("name", ["ortho.tif", "DJI_0001_V.JPG", "scan.las", "design.xml"])
def test_a_header_that_fails_to_read_is_not_recognised(name):
    got = classify(p(name), CountingReader(fail_all=True))
    assert (got.route, got.reason) == (None, cl.UNREADABLE)


def test_lens_of():
    assert lens_of(Path("DJI_20260930101500_0001_T.JPG")) == "T"
    assert lens_of(Path("dji_0001_v.jpg")) == "V"
    assert lens_of(Path("IMG_0001.JPG")) is None
    assert lens_of(Path("THERMAL.JPG")) is None


def test_xmp_fields_names_the_camera_and_parse_xmp_is_unchanged():
    assert xmp_fields(THERMAL_XMP)["ImageSource"] == b"InfraredCamera"
    assert xmp_fields(VISUAL_XMP)["ImageSource"] == b"WideCamera"
    assert xmp_fields(None) == {} and xmp_fields(b"") == {}
    assert parse_xmp(M3E_XMP)["rel_alt"] == 38.40
    assert parse_xmp(THERMAL_XMP) == {"rel_alt": 45.20, "gimbal_pitch": -30.40}


def test_crs_label_without_a_crs():
    assert cl.crs_label(32633, None) == "EPSG:32633"
    assert cl.crs_label(None, None) is None
    assert cl.crs_label(None, "not a wkt") is None
