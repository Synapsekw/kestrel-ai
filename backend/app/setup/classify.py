"""The drop-folder classifier for project setup (spec 2026-09-30-project-setup §7.2).

`classify` is pure: one file in, a `Classified` out, decided by the extension and, where the table
needs it, one header read through an injected `HeaderReader`, so tests count every read.
`RealHeaderReader` reuses the importers' own header readers and reads headers only: Pillow's lazy
open (JPEG markers up to the scan), rasterio's dataset header (`app.maps.raster.inspect_raster`),
laspy's header and VLRs (`app.pointclouds.lasfile.inspect_file`) and the first 64 KiB of an XML
file. rasterio, laspy, Pillow and pyproj are imported inside its methods, so importing this module
(the setup router does, at app start) stays cheap.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from app.surfaces.design.detect import DWG_MESSAGE

#: The one-line switch for S4 (index ruling S-R6): when video import merges, set this to True and
#: `.mp4/.mov` files sort into the `video` route instead of Not recognised.
VIDEO_IMPORT_ENABLED = False

UNKNOWN = "unknown type"
UNREADABLE = "could not read header"
VIDEO_COMING = "Video import is coming"
DNG_NOT_IMPORTED = "DNG raw photos are not imported yet; export them as JPEG"
NOT_LANDXML = "an XML file that is not LandXML"

HEADER_IMAGE_EXTS = frozenset({".jpg", ".jpeg"})
PLAIN_IMAGE_EXTS = frozenset({".png", ".bmp", ".webp"})
RASTER_EXTS = frozenset({".tif", ".tiff"})
CLOUD_EXTS = frozenset({".las", ".laz"})
DRAWING_EXTS = frozenset({".pdf", ".dxf"})
XML_EXTS = frozenset({".xml", ".landxml"})
VIDEO_EXTS = frozenset({".mp4", ".mov"})

#: The root element of a LandXML file is its first tag; a file that hides it past this is not one.
XML_HEAD_BYTES = 64 * 1024
#: DJI `drone-dji:ImageSource` of a thermal frame (H20T, M30T, M3T), lower-cased.
THERMAL_SOURCES = frozenset({b"infraredcamera"})
#: DJI names end in the lens: `_T` thermal, `_V` visual, `_W` wide, `_Z` zoom.
_DJI_LENS = re.compile(r"_([TVWZ])$", re.IGNORECASE)


@dataclass(frozen=True)
class RasterHeader:
    band_count: int
    dtype: str
    georeferenced: bool
    crs: str | None


@dataclass(frozen=True)
class ImageMeta:
    thermal: bool | None  # None: the headers do not say


@dataclass(frozen=True)
class LasHeader:
    crs: str | None


class HeaderReader(Protocol):
    def raster(self, path: Path) -> RasterHeader: ...

    def image_meta(self, path: Path) -> ImageMeta: ...

    def las(self, path: Path) -> LasHeader: ...

    def xml_root(self, path: Path) -> str | None: ...


@dataclass(frozen=True)
class Classified:
    route: str | None  # a SlotRoute value, or None for Not recognised
    match: dict = field(default_factory=dict)
    crs: str | None = None
    reason: str | None = None


#: (rule, test, route, match): first hit wins. A new case is one row and one fixture (spec §16).
RasterRule = tuple[str, Callable[[RasterHeader], bool], str, dict]
RASTER_RULES: tuple[RasterRule, ...] = (
    ("no coordinates: a camera's TIFF", lambda h: not h.georeferenced, "images", {}),
    (
        "one band that is not 8-bit: a height model",
        lambda h: h.band_count == 1 and h.dtype != "uint8",
        "elevation",
        {"raster": "elevation"},
    ),
    ("anything else with coordinates: an orthomosaic", lambda h: True, "map", {"raster": "ortho"}),
)


def lens_of(path: Path) -> str | None:
    """The DJI lens letter at the end of the file stem (`T`, `V`, `W`, `Z`), or None."""
    m = _DJI_LENS.search(path.stem)
    return m.group(1).upper() if m else None


def _photo(path: Path, meta: ImageMeta | None, thermal_default: bool) -> Classified:
    lens = lens_of(path)
    if meta is not None and meta.thermal is not None:
        thermal = meta.thermal
    elif lens is not None:
        thermal = lens == "T"
    else:
        thermal = thermal_default
    return Classified("images", {"thermal": thermal})


def _raster(path: Path, header: RasterHeader, thermal_default: bool) -> Classified:
    for _rule, test, route, match in RASTER_RULES:
        if test(header):
            if route == "images":
                return _photo(path, None, thermal_default)
            return Classified(route, dict(match), crs=header.crs)
    return Classified(None, reason=UNKNOWN)  # unreachable: the last rule takes everything


def classify(
    path: Path, reader: HeaderReader, *, read_header: bool = True, thermal_default: bool = False
) -> Classified:
    """Where `path` goes. `read_header=False` (a photo beyond the folder's header sample) decides
    by the file name, then `thermal_default` (the folder's sampled majority)."""
    ext = path.suffix.lower()
    try:
        if ext in HEADER_IMAGE_EXTS:
            return _photo(path, reader.image_meta(path) if read_header else None, thermal_default)
        if ext in PLAIN_IMAGE_EXTS:
            return _photo(path, None, thermal_default)
        if ext in RASTER_EXTS:
            return _raster(path, reader.raster(path), thermal_default)
        if ext in CLOUD_EXTS:
            return Classified("pointcloud", {}, crs=reader.las(path).crs)
        if ext in DRAWING_EXTS:
            return Classified("drawing")
        if ext in XML_EXTS:
            if reader.xml_root(path) == "LandXML":
                return Classified("drawing")
            return Classified(None, reason=NOT_LANDXML)
    except Exception:  # an OSError, a truncated header, a share that dropped: this file only
        return Classified(None, reason=UNREADABLE)
    if ext in VIDEO_EXTS:
        return Classified("video") if VIDEO_IMPORT_ENABLED else Classified(None, reason=VIDEO_COMING)
    if ext == ".dng":
        return Classified(None, reason=DNG_NOT_IMPORTED)
    if ext == ".dwg":
        return Classified(None, reason=DWG_MESSAGE)
    return Classified(None, reason=UNKNOWN)


def crs_label(epsg: int | None, wkt: str | None) -> str | None:
    """`EPSG:<code>` when there is one, else the CRS's own name, else None."""
    if epsg:
        return f"EPSG:{epsg}"
    if not wkt:
        return None
    try:
        from pyproj import CRS

        return CRS.from_wkt(wkt).name or None
    except Exception:
        return None


class RealHeaderReader:
    """The importers' own header readers. Each touches a header only, never pixels or points."""

    def raster(self, path: Path) -> RasterHeader:
        from app.maps.raster import inspect_raster

        info = inspect_raster(path)
        return RasterHeader(
            band_count=info.band_count,
            dtype=info.dtype,
            georeferenced=info.geotransform is not None,
            crs=crs_label(info.epsg, info.crs_wkt),
        )

    def image_meta(self, path: Path) -> ImageMeta:
        from PIL import Image

        from app.datasets.prepare import xmp_fields

        with Image.open(path) as opened:  # lazy: the markers up to the scan, no pixel decode
            packet = opened.info.get("xmp") or opened.info.get("XML:com.adobe.xmp")
        source = xmp_fields(packet).get("ImageSource", b"").strip().lower()
        return ImageMeta(thermal=(source in THERMAL_SOURCES) if source else None)

    def las(self, path: Path) -> LasHeader:
        from app.pointclouds.lasfile import inspect_file

        info = inspect_file(path)
        return LasHeader(crs=crs_label(info.crs.epsg, info.crs.crs_wkt))

    def xml_root(self, path: Path) -> str | None:
        import xml.etree.ElementTree as ET

        parser = ET.XMLPullParser(events=("start",))
        with path.open("rb") as f:
            parser.feed(f.read(XML_HEAD_BYTES))
        for _event, elem in parser.read_events():
            return elem.tag.rsplit("}", 1)[-1]
        return None
