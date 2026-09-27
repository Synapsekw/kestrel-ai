"""Canned DJI XMP packets and a JPEG writer that carries them (spec 2026-09-26-image-inspection §17)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import piexif
from PIL import Image

M3E_XMP = b"""<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="DJI Meta Data"
    xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
   drone-dji:AbsoluteAltitude="+112.874"
   drone-dji:RelativeAltitude="+38.40"
   drone-dji:GimbalRollDegree="+0.00"
   drone-dji:GimbalYawDegree="-12.30"
   drone-dji:GimbalPitchDegree="-89.90"
   drone-dji:FlightRollDegree="+1.10"
   drone-dji:FlightYawDegree="-11.60"
   drone-dji:FlightPitchDegree="+3.20"
   drone-dji:CalibratedFocalLength="3666.666504"
   drone-dji:CalibratedOpticalCenterX="2640.000000"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def h20t_xmp(status: str = "Normal", distance: str = "87.512") -> bytes:
    return f"""<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
   drone-dji:RelativeAltitude="+45.20" drone-dji:GimbalPitchDegree="-30.40"
   drone-dji:GimbalYawDegree="+101.70" drone-dji:GimbalRollDegree="+0.00"
   drone-dji:FlightYawDegree="+99.90" drone-dji:LRFStatus="{status}"
   drone-dji:LRFTargetDistance="{distance}"/>
</rdf:RDF></x:xmpmeta>""".encode()


MINI_XMP = b"""<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
 <rdf:Description rdf:about="DJI Meta Data" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">
  <drone-dji:RelativeAltitude>+25.10</drone-dji:RelativeAltitude>
  <drone-dji:GimbalPitchDegree>-45.00</drone-dji:GimbalPitchDegree>
  <drone-dji:GimbalYawDegree> -170.50 </drone-dji:GimbalYawDegree>
  <drone-dji:GimbalRollDegree>+0.00</drone-dji:GimbalRollDegree>
  <drone-dji:FlightYawDegree>+178.20</drone-dji:FlightYawDegree>
 </rdf:Description>
</rdf:RDF></x:xmpmeta>"""

# Mavic 3 Enterprise wide camera: 4/3" sensor 17.3 mm wide, 12.29 mm lens, 5280 x 3956 frames.
M3E = {"focal_mm": 12.29, "sensor_w_mm": 17.3, "orig": (5280, 3956), "model": "M3E"}


def _dms(value: float):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600 * 10000)
    return ((d, 1), (m, 1), (s, 10000))


def dji_jpeg(
    path: Path,
    *,
    size: tuple[int, int] = (800, 600),
    seed: int = 0,
    xmp: bytes | None = M3E_XMP,
    focal_mm: float | None = 12.29,
    sensor_w_mm: float | None = 17.3,
    orig: tuple[int, int] | None = (5280, 3956),
    model: str | None = "M3E",
    lat: float | None = 25.26412,
    lon: float | None = 55.29218,
    orientation: int | None = None,
) -> Path:
    """A seeded-noise JPEG with DJI-style EXIF (focal, focal-plane resolution, model, GPS) and XMP."""
    rng = np.random.default_rng(seed)
    im = Image.fromarray(rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8), "RGB")
    zeroth: dict = {}
    if model:
        zeroth[piexif.ImageIFD.Model] = model.encode()
    if orientation:
        zeroth[piexif.ImageIFD.Orientation] = orientation
    exif_ifd: dict = {}
    if focal_mm:
        exif_ifd[piexif.ExifIFD.FocalLength] = (round(focal_mm * 100), 100)
    if orig:
        exif_ifd[piexif.ExifIFD.PixelXDimension] = orig[0]
        exif_ifd[piexif.ExifIFD.PixelYDimension] = orig[1]
        if sensor_w_mm:
            exif_ifd[piexif.ExifIFD.FocalPlaneXResolution] = (round(orig[0] / sensor_w_mm * 10 * 1000), 1000)
            exif_ifd[piexif.ExifIFD.FocalPlaneResolutionUnit] = 3  # centimetres
    gps: dict = {}
    if lat is not None and lon is not None:
        gps = {
            piexif.GPSIFD.GPSLatitudeRef: "N" if lat >= 0 else "S",
            piexif.GPSIFD.GPSLatitude: _dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: "E" if lon >= 0 else "W",
            piexif.GPSIFD.GPSLongitude: _dms(lon),
        }
    kwargs: dict = {"quality": 90, "exif": piexif.dump({"0th": zeroth, "Exif": exif_ifd, "GPS": gps})}
    if xmp:
        kwargs["xmp"] = xmp
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", **kwargs)
    return path


def fake_image(**kw) -> SimpleNamespace:
    """An object shaped like the ORM Image for the pure camera/footprint functions."""
    base = dict(
        width=800,
        height=600,
        subject_distance_m=None,
        lrf_distance_m=None,
        rel_alt=None,
        gimbal_pitch=None,
        gimbal_yaw=None,
        flight_yaw=None,
        focal_px=None,
        focal_mm=None,
        sensor_w_mm=None,
        orig_w=None,
        orig_h=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)
