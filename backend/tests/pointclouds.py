"""Point-cloud test fixtures (spec 2026-09-23-point-clouds section 5 item 9), generated at test time.

`make_las` writes a tiny LAS or LAZ with laspy, optionally with header bounds deliberately too small
(the Pix4D trap: its "Chimney stack 3D" header misses the true max by 0.3 mm). `write_fake_octree`
writes a minimal valid Potree 2.0 octree: one leaf root node, `DEFAULT` encoding, position + rgb.

laspy is imported inside the functions that need it, so importing this module (conftest does) costs
nothing and never fails on an interpreter without laspy.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

# The spike's fixture site: EPSG:32639 (UTM 39N) coordinates near the chimney file.
ORIGIN = (553_100.0, 2_847_300.0, -45.0)
EXTENT = (10.0, 10.0, 5.0)
SCALE = 0.001
# LAS header: max_x, min_x, max_y, min_y, max_z, min_z as little-endian doubles from byte 179,
# the same in LAS 1.0-1.4 and in LAZ (whose header is not compressed).
BOUNDS_OFFSET = 179
RGB_FORMATS = {2, 3, 5, 7, 8, 10}
POINT_RECORD = 18  # DEFAULT encoding: int32 x, y, z + uint16 r, g, b
HIERARCHY_NODE = 22  # type u8, childMask u8, numPoints u32, byteOffset i64, byteSize i64


def default_points(n: int, seed: int = 0) -> np.ndarray:
    """`n` points in a 10 x 10 x 5 m box at ORIGIN, float64 (n, 3), deterministic."""
    rng = np.random.default_rng(seed)
    return np.asarray(ORIGIN) + rng.random((n, 3)) * np.asarray(EXTENT)


def west_red_east_green(xyz: np.ndarray) -> np.ndarray:
    """uint16 (n, 3) colours: red in the west half, green in the east half (the check:webview fixture)."""
    mid = (xyz[:, 0].min() + xyz[:, 0].max()) / 2
    rgb = np.zeros((len(xyz), 3), dtype=np.uint16)
    west = xyz[:, 0] < mid
    rgb[west, 0] = 65535
    rgb[~west, 1] = 65535
    return rgb


def make_las(
    path: Path,
    n: int,
    *,
    epsg: int | None = 32639,
    rgb: bool = True,
    compressed: bool = False,
    header_shrink_mm: float = 0.0,
    points: np.ndarray | None = None,
    version: str = "1.2",
    point_format: int = 3,
) -> Path:
    """Write `n` points (or exactly `points`, float64 (n, 3)) to a LAS, or a LAZ when `compressed`.

    `epsg=None` writes no CRS. `rgb` fills the colour of a format that has one (red west, green
    east). `header_shrink_mm` moves the header's max X that far inwards after writing, so the header
    no longer contains every point. Classification is 2 (ground) for every point.
    """
    import laspy

    xyz = default_points(n) if points is None else np.asarray(points, dtype=np.float64)
    header = laspy.LasHeader(point_format=point_format, version=version)
    header.scales = np.array([SCALE, SCALE, SCALE])
    header.offsets = np.floor(xyz.min(axis=0)) if len(xyz) else np.zeros(3)
    if epsg is not None:
        from pyproj import CRS

        header.add_crs(CRS.from_epsg(epsg))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    las.classification = np.full(len(xyz), 2, dtype=np.uint8)
    if rgb and point_format in RGB_FORMATS:
        colours = west_red_east_green(xyz) if len(xyz) else np.zeros((0, 3), dtype=np.uint16)
        las.red, las.green, las.blue = colours[:, 0], colours[:, 1], colours[:, 2]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path, do_compress=compressed)
    if header_shrink_mm:
        with path.open("r+b") as f:
            f.seek(BOUNDS_OFFSET)
            (max_x,) = struct.unpack("<d", f.read(8))
            f.seek(BOUNDS_OFFSET)
            f.write(struct.pack("<d", max_x - header_shrink_mm / 1000.0))
    return path


def read_header_bounds(path: Path) -> list[float]:
    """The header's [minx, miny, minz, maxx, maxy, maxz], read straight from bytes 179-226."""
    with Path(path).open("rb") as f:
        f.seek(BOUNDS_OFFSET)
        max_x, min_x, max_y, min_y, max_z, min_z = struct.unpack("<6d", f.read(48))
    return [min_x, min_y, min_z, max_x, max_y, max_z]


def write_fake_octree(
    points: np.ndarray, out_dir: Path, *, rgb: np.ndarray | None = None, scale: float = SCALE
) -> Path:
    """Write a minimal valid Potree 2.0 octree (metadata.json, hierarchy.bin, octree.bin) into `out_dir`.

    One leaf root node holds every point, `DEFAULT` encoding, attributes position (int32 x 3) and rgb
    (uint16 x 3), the layout potree-core 2.0.15's DEFAULT decoder reads: a point's coordinate is
    `int32 * scale + offset`. The bounding box is a cube from the points' min, as the converter
    writes it. Test-only: it holds the points in memory, so it is for tiny fixtures.
    """
    xyz = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if len(xyz) == 0:
        raise ValueError("an octree needs at least one point")
    colours = west_red_east_green(xyz) if rgb is None else np.asarray(rgb, dtype=np.uint16).reshape(-1, 3)
    lo, hi = xyz.min(axis=0), xyz.max(axis=0)
    size = max(float((hi - lo).max()), scale)
    cube_max = lo + size
    ints = np.round((xyz - lo) / scale).astype("<i4")
    records = np.zeros(len(xyz), dtype=[("pos", "<i4", 3), ("rgb", "<u2", 3)])
    records["pos"], records["rgb"] = ints, colours
    body = records.tobytes()
    assert len(body) == POINT_RECORD * len(xyz)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "octree.bin").write_bytes(body)
    (out / "hierarchy.bin").write_bytes(struct.pack("<BBIqq", 1, 0, len(xyz), 0, len(body)))
    metadata = {
        "version": "2.0",
        "name": "fake",
        "description": "",
        "points": int(len(xyz)),
        "projection": "",
        "hierarchy": {"firstChunkSize": HIERARCHY_NODE, "stepSize": 4, "depth": 0},
        "offset": lo.tolist(),
        "scale": [scale, scale, scale],
        "spacing": size / 128.0,
        "boundingBox": {"min": lo.tolist(), "max": cube_max.tolist()},
        "encoding": "DEFAULT",
        "attributes": [
            {
                "name": "position",
                "description": "",
                "size": 12,
                "numElements": 3,
                "elementSize": 4,
                "type": "int32",
                "min": lo.tolist(),
                "max": hi.tolist(),
            },
            {
                "name": "rgb",
                "description": "",
                "size": 6,
                "numElements": 3,
                "elementSize": 2,
                "type": "uint16",
                "min": colours.min(axis=0).tolist(),
                "max": colours.max(axis=0).tolist(),
            },
        ],
    }
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2), "utf-8")
    return out


def read_fake_octree(out_dir: Path) -> tuple[dict, np.ndarray, np.ndarray]:
    """Decode an octree written by `write_fake_octree`: (metadata, xyz float64 (n, 3), rgb uint16 (n, 3))."""
    out = Path(out_dir)
    meta = json.loads((out / "metadata.json").read_text("utf-8"))
    kind, mask, count, offset, size = struct.unpack("<BBIqq", (out / "hierarchy.bin").read_bytes()[:22])
    raw = (out / "octree.bin").read_bytes()[offset : offset + size]
    records = np.frombuffer(raw, dtype=[("pos", "<i4", 3), ("rgb", "<u2", 3)], count=count)
    xyz = records["pos"] * np.asarray(meta["scale"]) + np.asarray(meta["offset"])
    return meta, xyz, records["rgb"].copy()
