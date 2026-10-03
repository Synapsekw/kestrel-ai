# backend/tests/fixtures/synthetic_tower.py
"""The asset-inspection kit's synthetic telecom tower, generated at test time (spec
2026-10-02-asset-findings A10 and §12; index "Shared fixtures").

A port of the kit's `examples/synthetic-tower/` (the operator's own code, no customer data):
- `make_tower.py`: the 42 m lattice tower GLB with six defects (D1 to D6), same geometry;
- `shoot.py`: 32 camera poses (four rings of eight), same formulas; instead of a WebGL render, each
  photo is a flat sky with a filled disc where each visible defect projects, so no browser is needed;
- `detect_truth.py`: the truth sightings (a box around each visible defect per photo), with the
  occlusion test done by a numpy ray cast (Moller-Trumbore) instead of trimesh's rtree ray engine.

Photos are 1600 x 1067 JPEGs named `DJI_0001.JPG` ... with EXIF GPS (lat, lon, altitude),
FocalLength 4.5 mm and FocalLengthIn35mmFilm 31, and DJI XMP gimbal yaw, pitch and roll, in the
form `app.datasets.prepare.read_exif` and `read_camera` read on import.
"""

from __future__ import annotations

import copy
import functools
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import piexif
import trimesh
from PIL import Image, ImageDraw

from app.asset_review.frame import Frame, Origin, Preset
from app.asset_review.raycast import first_hits

LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
EARTH_R = 6378137.0
PHOTO_W, PHOTO_H = 1600, 1067
FOCAL_MM, F35 = 4.5, 31
HFOV = 2 * math.degrees(math.atan(36 / (2 * F35)))
VFOV = 2 * math.degrees(math.atan(math.tan(math.radians(HFOV / 2)) * PHOTO_H / PHOTO_W))
HEIGHT_M = 42.0
PROFILE_ID = "telecom_tower"
SKY = (159, 183, 207)
STEEL = [150, 156, 162, 255]
CLASS_RGB = {
    "corrosion": (168, 82, 30),
    "fastener": (200, 30, 40),
    "foreign": (96, 72, 40),
    "antenna": (225, 225, 222),
    "coating": (222, 190, 70),
    "cable": (40, 40, 40),
}
XMP = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" '
    'drone-dji:AbsoluteAltitude="{alt:+.3f}" drone-dji:RelativeAltitude="{rel:+.3f}" '
    'drone-dji:GimbalRollDegree="{roll:+.2f}" drone-dji:GimbalYawDegree="{yaw:+.2f}" '
    'drone-dji:GimbalPitchDegree="{pitch:+.2f}" drone-dji:FlightYawDegree="{yaw:+.2f}"/>'
    "</rdf:RDF></x:xmpmeta>"
)

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class TruthSighting:
    image_name: str
    box: tuple[float, float, float, float]  # x, y, w, h in photo pixels, top-left origin


@dataclass(frozen=True)
class TruthFinding:
    id: str
    cls: str  # the kit's telecom-tower class key
    severity: int
    center: Vec3
    radius: float
    note: str
    zone: str  # the telecom_tower zone id at H = 42 m, written out by hand (not computed)
    side: str  # the compass side, written out by hand (not computed)
    sightings: tuple[TruthSighting, ...]


@dataclass(frozen=True)
class Tower:
    glb_path: Path
    frame: Frame
    poses: list[dict]
    truth: list[TruthFinding]
    photos_dir: Path | None
    profile_id: str = PROFILE_ID
    image_size: tuple[int, int] = (PHOTO_W, PHOTO_H)


def _half(y: float) -> float:
    return 3.0 - (3.0 - 0.9) * min(y, 36) / 36


def _corners(y: float) -> list[Vec3]:
    h = _half(y) if y <= 36 else 0.9
    return [(h * sx, y, h * sz) for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1))]


def _on_leg(k: int, y: float, out: float = 0.1) -> list[float]:
    x, _, z = _corners(y)[k]
    n = np.array([x, 0.0, z])
    n /= np.linalg.norm(n)
    return (np.array([x, y, z]) + n * out).tolist()


def _build_parts() -> tuple[list[tuple[str, trimesh.Trimesh]], list[dict]]:
    """`make_tower.py`, statement for statement: parts in the same order, the same truth."""
    parts: list[tuple[str, trimesh.Trimesh]] = []

    def cyl(a, b, r, color, name):
        a, b = np.array(a, float), np.array(b, float)
        v = b - a
        length = np.linalg.norm(v)
        m = trimesh.creation.cylinder(radius=r, height=length, sections=10)
        zax = np.array([0, 0, 1.0])
        d = v / length
        ax = np.cross(zax, d)
        s = np.linalg.norm(ax)
        rot = np.eye(4)
        if s > 1e-9:
            rot[:3, :3] = trimesh.transformations.rotation_matrix(math.atan2(s, np.dot(zax, d)), ax / s)[
                :3, :3
            ]
        elif np.dot(zax, d) < 0:
            rot[:3, :3] = np.diag([1, -1, -1])
        m.apply_transform(rot)
        m.apply_translation((a + b) / 2)
        m.visual.face_colors = color
        parts.append((name, m))

    def box(ext, center, color, name, rot=None):
        m = trimesh.creation.box(extents=ext)
        if rot is not None:
            m.apply_transform(rot)
        m.apply_translation(center)
        m.visual.face_colors = color
        parts.append((name, m))

    levels = [*np.arange(0, 36.01, 3).tolist(), 39, 42]
    for i in range(len(levels) - 1):
        c0, c1 = _corners(levels[i]), _corners(levels[i + 1])
        for k in range(4):
            cyl(c0[k], c1[k], 0.09, STEEL, "Leg")
            a, b = c0[k], c0[(k + 1) % 4]
            c, d = c1[k], c1[(k + 1) % 4]
            cyl(a, d, 0.04, STEEL, "Bracing")
            cyl(b, c, 0.04, STEEL, "Bracing")
            cyl(c, d, 0.05, STEEL, "Horizontal")
    for py in (30, 36):
        h = _half(py) + 0.6
        box([2 * h, 0.08, 2 * h], [0, py, 0], [120, 124, 130, 255], "Platform")
        for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            cyl((h * sx, py, h * sz), (h * sx, py + 1.1, h * sz), 0.03, STEEL, "Handrail")
    ant_truth = []
    for sb in (30, 150, 270):
        for off in (-0.45, 0.45):
            b = math.radians(sb)
            r = 1.35
            cx, cz = r * math.cos(b) - off * math.sin(b), r * math.sin(b) + off * math.cos(b)
            rot = trimesh.transformations.rotation_matrix(-b, [0, 1, 0])
            tilted = sb == 150 and off > 0
            if tilted:
                rot = rot @ trimesh.transformations.rotation_matrix(math.radians(22), [0, 0, 1])
            box([0.14, 1.9, 0.34], [cx, 39.2, cz], [225, 225, 222, 255], "Antenna", rot)
            cyl((0.9 * math.cos(b), 39.2, 0.9 * math.sin(b)), (cx, 39.2, cz), 0.04, STEEL, "Antenna mount")
            if tilted:
                ant_truth.append([cx, 39.2, cz])
    cyl(
        (_half(0) * 0.85, 0.5, _half(0) * 0.85),
        (0.9 * 0.85, 38, 0.9 * 0.85),
        0.05,
        [40, 40, 40, 255],
        "Feeder cable",
    )

    truth: list[dict] = []

    def blob(mesh, p, color, name):
        mesh.apply_translation(p)
        mesh.visual.face_colors = color
        parts.append((name, mesh))

    p = _on_leg(0, 12)
    m = trimesh.creation.icosphere(2, 0.22)
    m.apply_scale([1, 1.6, 1])
    blob(m, p, [168, 82, 30, 255], "Leg")
    truth.append(
        {
            "id": "D1",
            "class": "corrosion",
            "severity": 2,
            "center": p,
            "radius": 0.35,
            "note": "Rust staining on the leg around a bolted splice.",
        }
    )
    p = _on_leg(2, 21)
    blob(trimesh.creation.box(extents=[0.3, 0.3, 0.3]), p, [200, 30, 40, 255], "Leg")
    truth.append(
        {
            "id": "D2",
            "class": "fastener",
            "severity": 3,
            "center": p,
            "radius": 0.25,
            "note": "Splice plate with an empty bolt hole; a bolt appears to be missing.",
        }
    )
    p = [_half(30) * 0.4, 30.35, -_half(30) * 0.3]
    m = trimesh.creation.icosphere(2, 0.4)
    m.apply_scale([1.3, 0.6, 1.1])
    blob(m, p, [96, 72, 40, 255], "Platform")
    truth.append(
        {
            "id": "D3",
            "class": "foreign",
            "severity": 1,
            "center": p,
            "radius": 0.5,
            "note": "Bird nest on the 30 m platform grating.",
        }
    )
    truth.append(
        {
            "id": "D4",
            "class": "antenna",
            "severity": 2,
            "center": ant_truth[0],
            "radius": 0.9,
            "note": "Sector 2 panel is tilted about 20 degrees relative to its neighbour.",
        }
    )
    p = _on_leg(1, 6, 0.12)
    m = trimesh.creation.icosphere(2, 0.3)
    m.apply_scale([1, 2.2, 1])
    blob(m, p, [222, 190, 70, 255], "Leg")
    truth.append(
        {
            "id": "D5",
            "class": "coating",
            "severity": 1,
            "center": p,
            "radius": 0.5,
            "note": "Galvanising breakdown with light white rust on the lower leg.",
        }
    )
    p = [0.9 * 0.85 + 0.35, 27.0, 0.9 * 0.85 + 0.6]
    cyl([0.9 * 0.85 + 0.05, 28.2, 0.9 * 0.85 + 0.05], p, 0.05, [40, 40, 40, 255], "Feeder cable")
    truth.append(
        {
            "id": "D6",
            "class": "cable",
            "severity": 2,
            "center": [0.9 * 0.85 + 0.2, 27.6, 0.9 * 0.85 + 0.33],
            "radius": 0.7,
            "note": "Feeder cable has come out of its clamp and hangs free.",
        }
    )
    box([12, 0.3, 12], [0, -0.15, 0], [170, 164, 150, 255], "Foundation")
    return parts, truth


#: Hand-derived zone and side of each truth centre (telecom_tower, H = 42 m: antenna >= 33.6 m,
#: body 4.2 to 33.6 m; compass sector = floor(bearing / 45 + 0.5)).
TRUTH_ZONE_SIDE = {
    "D1": ("body", "NE"),  # (2.371, 12, 2.371): 45.0 deg
    "D2": ("body", "SW"),  # (-1.846, 21, -1.846): 225.0 deg
    "D3": ("body", "NW"),  # (0.5, 30.35, -0.375): 323.1 deg
    "D4": ("antenna", "S"),  # (-1.394, 39.2, 0.285): 168.4 deg
    "D5": ("body", "NW"),  # (2.735, 6, -2.735): 315.0 deg
    "D6": ("body", "NE"),  # (0.965, 27.6, 1.095): 48.6 deg
}


def _poses() -> list[dict]:
    """`shoot.py`: four rings (7, 17, 27, 38 m) of eight shots looking at the axis, 2 m below level."""
    poses = []
    k = 0
    for h in (7, 17, 27, 38):
        for a in range(0, 360, 45):
            radius = 15 + (h > 30) * 3
            ar = math.radians(a + (h % 10) * 3)
            x, z, y = radius * math.cos(ar), radius * math.sin(ar), float(h)
            yaw = (math.degrees(math.atan2(-z, -x)) + 360) % 360
            pitch = math.degrees(math.atan2(-2.0, radius))
            roll = 3.0 if k % 7 == 3 else 0.0
            pr, yr = math.radians(pitch), math.radians(yaw)
            d = [math.cos(pr) * math.cos(yr), math.sin(pr), math.cos(pr) * math.sin(yr)]
            t = -(x * d[0] + z * d[2]) / (d[0] ** 2 + d[2] ** 2)
            target = [x + d[0] * t, y + d[1] * t, z + d[2] * t]
            up = [0.0, 1.0, 0.0]
            if roll:
                r = math.radians(roll)
                c, s = math.cos(r), math.sin(r)
                kv = sum(d[i] * up[i] for i in range(3))
                cr = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]
                up = [up[i] * c + cr[i] * s + d[i] * kv * (1 - c) for i in range(3)]
            lat = LAT0 + math.degrees(x / EARTH_R)
            lon = LON0 + math.degrees(z / (EARTH_R * math.cos(math.radians(LAT0))))
            name = f"DJI_{k + 1:04d}.JPG"
            poses.append(
                {
                    "id": f"p{k + 1:03d}",
                    "name": name,
                    "source_name": name,
                    "sequence": "1",
                    "position": [x, y, z],
                    "target": target,
                    "up": up,
                    "hfov": HFOV,
                    "vfov": VFOV,
                    "yaw": yaw,
                    "pitch": pitch,
                    "roll": roll,
                    "latitude": lat,
                    "longitude": lon,
                    "altitude": ALT0 + y,
                    "width": PHOTO_W,
                    "height": PHOTO_H,
                    "time": f"2026:09:20 09:{10 + k // 8:02d}:{(k % 8) * 7:02d}",
                    "orientation_source": "gimbal XMP",
                }
            )
            k += 1
    return poses


def _first_hit(tris: np.ndarray, origin: np.ndarray, direction: np.ndarray) -> float:
    """Distance along a unit ray to the nearest triangle, or inf (`app.asset_review.raycast`)."""
    t, _ = first_hits(
        tris.reshape(-1, 3), np.arange(len(tris) * 3).reshape(-1, 3), origin[None, :], direction[None, :]
    )
    return float(t[0])


def _sightings(tris: np.ndarray, poses: list[dict], truth: list[dict]) -> dict[str, list[TruthSighting]]:
    """`detect_truth.py`: project each defect into each photo, keep it when it is inside 97% of the
    frame, at least 7 px in radius and not hidden behind other geometry; box = centre +- radius,
    clipped to the photo."""
    out: dict[str, list[TruthSighting]] = {d["id"]: [] for d in truth}
    for p in poses:
        c = np.array(p["position"])
        f = np.array(p["target"]) - c
        f /= np.linalg.norm(f)
        up = np.array(p["up"])
        r = np.cross(f, up)
        r /= np.linalg.norm(r)
        u = np.cross(r, f)
        th, tv = math.tan(math.radians(p["hfov"] / 2)), math.tan(math.radians(p["vfov"] / 2))
        for d in truth:
            x_rel = np.array(d["center"]) - c
            depth = float(x_rel @ f)
            if depth <= 0:
                continue
            x, y = float(x_rel @ r) / depth / th, float(x_rel @ u) / depth / tv
            if abs(x) > 0.97 or abs(y) > 0.97:
                continue
            px, py = (x + 1) / 2 * PHOTO_W, (1 - y) / 2 * PHOTO_H
            rad = d["radius"] / depth / tv * PHOTO_H / 2
            if rad < 7:
                continue
            dist = float(np.linalg.norm(x_rel))
            if _first_hit(tris, c, x_rel / dist) < dist - d["radius"] * 1.1:
                continue
            x0, y0 = max(0.0, round(px - rad, 1)), max(0.0, round(py - rad, 1))
            x1, y1 = min(float(PHOTO_W), round(px + rad, 1)), min(float(PHOTO_H), round(py + rad, 1))
            out[d["id"]].append(TruthSighting(p["name"], (x0, y0, round(x1 - x0, 1), round(y1 - y0, 1))))
    return out


@functools.cache
def _model() -> tuple[bytes, tuple[TruthFinding, ...], tuple[dict, ...]]:
    """Built once per test process: the GLB bytes, the truth and the poses."""
    parts, raw_truth = _build_parts()
    scene = trimesh.Scene()
    for i, (name, m) in enumerate(parts):
        scene.add_geometry(m, node_name=f"{name}_{i:03d}", geom_name=f"g{i:03d}")
    glb = scene.export(file_type="glb")
    tris = trimesh.util.concatenate([m for _, m in parts]).triangles
    poses = _poses()
    seen = _sightings(tris, poses, raw_truth)
    truth = tuple(
        TruthFinding(
            id=d["id"],
            cls=d["class"],
            severity=d["severity"],
            center=(float(d["center"][0]), float(d["center"][1]), float(d["center"][2])),
            radius=d["radius"],
            note=d["note"],
            zone=TRUTH_ZONE_SIDE[d["id"]][0],
            side=TRUTH_ZONE_SIDE[d["id"]][1],
            sightings=tuple(seen[d["id"]]),
        )
        for d in raw_truth
    )
    return glb, truth, tuple(poses)


def _dms(v: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    v = abs(v)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return ((d, 1), (m, 1), (int(round(s * 10000)), 10000))


def _write_photo(path: Path, pose: dict, discs: list[tuple[tuple[float, float, float, float], str]]) -> None:
    im = Image.new("RGB", (PHOTO_W, PHOTO_H), SKY)
    draw = ImageDraw.Draw(im)
    for (x, y, w, h), cls in discs:
        draw.ellipse([x, y, x + w, y + h], fill=CLASS_RGB[cls])
    lat, lon, alt = pose["latitude"], pose["longitude"], pose["altitude"]
    exif = {
        "0th": {piexif.ImageIFD.Make: b"SynthDrone", piexif.ImageIFD.Model: b"KitTest"},
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: pose["time"].encode(),
            piexif.ExifIFD.FocalLength: (45, 10),
            piexif.ExifIFD.FocalLengthIn35mmFilm: F35,
            piexif.ExifIFD.PixelXDimension: PHOTO_W,
            piexif.ExifIFD.PixelYDimension: PHOTO_H,
        },
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
            piexif.GPSIFD.GPSLatitude: _dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
            piexif.GPSIFD.GPSLongitude: _dms(lon),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (int(round(alt * 1000)), 1000),
        },
    }
    yaw = pose["yaw"] if pose["yaw"] <= 180 else pose["yaw"] - 360
    xmp = XMP.format(alt=alt, rel=pose["position"][1], roll=pose["roll"], yaw=yaw, pitch=pose["pitch"])
    im.save(path, "JPEG", quality=85, exif=piexif.dump(exif), xmp=xmp.encode())


def tower_frame() -> Frame:
    return Frame(
        origin=Origin(lat=LAT0, lon=LON0, ground_alt_m=ALT0),
        north_offset_deg=0.0,
        height_m=HEIGHT_M,
        datum_label="Ground",
        datum_note="Synthetic tower; the foundation slab top is 0 m",
        line_azimuth_deg=None,
        silhouette=[(0.0, 4.243), (36.0, 1.273), (42.0, 1.273)],
        levels=[30.0, 36.0],
        presets=[Preset(id="antennas", label="Antennas", target=(0.0, 39.2, 0.0), camera=(8.0, 42.0, 8.0))],
    )


def make_tower(tmp_path: Path, *, photos: bool = True) -> Tower:
    """Write `model.glb` (and with `photos`, `photos/DJI_0001.JPG` ... `DJI_0032.JPG`) under
    `tmp_path`. Deterministic: the same bytes on every call."""
    glb, truth, poses = _model()
    tmp_path.mkdir(parents=True, exist_ok=True)
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(glb)
    photos_dir = None
    if photos:
        photos_dir = tmp_path / "photos"
        photos_dir.mkdir(exist_ok=True)
        by_image: dict[str, list] = {}
        for t in truth:
            for s in t.sightings:
                by_image.setdefault(s.image_name, []).append((s.box, t.cls))
        for pose in poses:
            _write_photo(photos_dir / pose["name"], pose, by_image.get(pose["name"], []))
    return Tower(
        glb_path=glb_path,
        frame=tower_frame(),
        poses=copy.deepcopy(list(poses)),
        truth=list(truth),
        photos_dir=photos_dir,
    )
