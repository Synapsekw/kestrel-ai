"""Helpers for S1-U3's setup-inspect tests: a HeaderReader that answers from canned headers and
counts every read, DJI XMP packets that name the camera, and file-tree writers."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from pathlib import Path

from app.setup.classify import ImageMeta, LasHeader, RasterHeader

ORTHO = RasterHeader(band_count=3, dtype="uint8", georeferenced=True, crs="EPSG:32633")
DSM = RasterHeader(band_count=1, dtype="float32", georeferenced=True, crs="EPSG:32633")
NO_META = ImageMeta(thermal=None)
DEFAULT_LAS = LasHeader(crs="EPSG:32639")


def _dji_xmp(source: str) -> bytes:
    return (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="DJI Meta Data" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"'
        f' drone-dji:ImageSource="{source}" drone-dji:RelativeAltitude="+45.20"'
        ' drone-dji:GimbalPitchDegree="-30.40"/></rdf:RDF></x:xmpmeta>'
    ).encode()


THERMAL_XMP = _dji_xmp("InfraredCamera")
VISUAL_XMP = _dji_xmp("WideCamera")


class CountingReader:
    """A HeaderReader whose answers are canned (a value, or a function of the path) and whose every
    call is counted by method and recorded by path. A name in `fail` (or every name with
    `fail_all`) raises OSError, as a dropped share or a locked file would."""

    def __init__(
        self,
        *,
        raster: RasterHeader | Callable[[Path], RasterHeader] = ORTHO,
        image: ImageMeta | Callable[[Path], ImageMeta] = NO_META,
        las: LasHeader = DEFAULT_LAS,
        xml_root: str | None = "LandXML",
        fail: tuple[str, ...] = (),
        fail_all: bool = False,
    ):
        self.calls: Counter[str] = Counter()
        self.paths: list[Path] = []
        self._raster, self._image, self._las, self._xml_root = raster, image, las, xml_root
        self.fail, self.fail_all = set(fail), fail_all

    def _hit(self, method: str, path: Path) -> None:
        self.calls[method] += 1
        self.paths.append(path)
        if self.fail_all or path.name in self.fail:
            raise OSError(21, "The device is not ready", str(path))

    def raster(self, path: Path) -> RasterHeader:
        self._hit("raster", path)
        return self._raster(path) if callable(self._raster) else self._raster

    def image_meta(self, path: Path) -> ImageMeta:
        self._hit("image_meta", path)
        return self._image(path) if callable(self._image) else self._image

    def las(self, path: Path) -> LasHeader:
        self._hit("las", path)
        return self._las

    def xml_root(self, path: Path) -> str | None:
        self._hit("xml_root", path)
        return self._xml_root

    def reads_in(self, folder: Path) -> int:
        return sum(1 for p in self.paths if p.parent == folder)


def dji_names(n: int, lens: str = "V", start: int = 1) -> list[str]:
    """DJI M30T/M3T style names: DJI_<timestamp>_<index>_<lens>.JPG."""
    return [f"DJI_20260930101500_{i:04d}_{lens}.JPG" for i in range(start, start + n)]


def touch_files(folder: Path, names: list[str], content: bytes = b"") -> list[Path]:
    """Empty (or tiny) files: the fake reader answers for them, nothing parses them."""
    folder.mkdir(parents=True, exist_ok=True)
    paths = [folder / name for name in names]
    for p in paths:
        p.write_bytes(content)
    return paths
