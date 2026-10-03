# backend/app/asset_review/place.py
"""Back-projection of sightings onto an asset model (spec 2026-10-02-asset-findings §6.3).

A port of the kit's `project.py`. A photo with a pose is a pinhole camera. A sighting's box, in the
stored image's pixels (`image.width` x `image.height`), becomes a fan of rays into the mesh:

- point: the median-distance hit of a 5 x 5 grid in the central half of the box, with the hit
  face's normal turned toward the camera (a pin);
- patch: a `patch_grid` ray grid over the box. Adjacent hits make quads; a quad with an edge over
  4 times the median step is dropped (it spans a depth jump); the surface is lifted toward the
  camera by H * 0.00025. UVs map back to the box crop, textured with the polygon in its severity
  colour over the photo (a tinted box when there is no polygon);
- mixed: a polygon gives a patch, a box gives a pin;
- none: no ray hits. Never a fake position.

Every ray of one sighting goes to the mesh in one `cast` (`app.asset_review.raycast`).
Pure: no database, and no files except `write_patch` and `write_index`.
"""

from __future__ import annotations

import io
import json
import math
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image as PILImage
from PIL import ImageDraw

from app.asset_review import raycast
from app.asset_review.derive import Derived, component_name, derive
from app.geometry import aabb_of, corners_of

PREVIEW_SIDE = 2048  # photos are read at this long side, never the original (Global Constraints)
POINT_GRID = 5
DEFAULT_PATCH_GRID = 48  # the kit's default when a profile sets none
EDGE_FACTOR = 4.0
OFFSET_FRACTION = 0.00025  # of the asset height, toward the camera
TEXTURE_MAX = 512
LABEL_MAX = 128
FILL_MIX = 0.55  # share of the severity colour over the photo inside the polygon
FILL_ALPHA = 230
TINT_ALPHA = 110  # the kit's tinted box
PATCH_FORMAT = 1  # the index.json format
INDEX_NAME = "index.json"


@dataclass(frozen=True)
class SightingShape:
    """The annotation behind a sighting, in the stored image's pixels. `x, y, w, h` are the
    unrotated box (top-left, size); a polygon keeps its envelope with `angle = 0`; a point has
    `w = h = 0` (app/imagery/shapes.py)."""

    x: float
    y: float
    w: float
    h: float
    angle: float = 0.0
    kind: str = "box"  # box | rbox | polygon | point
    points: tuple[tuple[float, float], ...] | None = None

    @classmethod
    def from_box(cls, box) -> SightingShape:
        pts = tuple((float(p[0]), float(p[1])) for p in box.points) if box.points else None
        return cls(
            float(box.x), float(box.y), float(box.w), float(box.h), float(box.angle or 0.0), box.shape, pts
        )

    def bbox(self, image_size: tuple[int, int]) -> tuple[float, float, float, float]:
        """The axis-aligned envelope `(x0, y0, x1, y1)`, clamped to the image."""
        W, H = image_size
        ax, ay, aw, ah = aabb_of(self.x, self.y, self.w, self.h, self.angle)
        x0, y0 = min(max(ax, 0.0), W), min(max(ay, 0.0), H)
        return x0, y0, min(max(ax + aw, x0), W), min(max(ay + ah, y0), H)

    def outline(self) -> list[tuple[float, float]] | None:
        """The region to fill in a texture: the polygon, or a rotated box's corners. None for an
        upright box or a point (they get the tinted box)."""
        if self.kind == "polygon" and self.points:
            return list(self.points)
        if self.kind == "rbox" or (self.kind == "box" and self.angle):
            return corners_of(self.x, self.y, self.w, self.h, self.angle)
        return None

    def area(self) -> float:
        if self.kind == "polygon" and self.points and len(self.points) >= 3:
            xs = np.array([p[0] for p in self.points])
            ys = np.array([p[1] for p in self.points])
            return float(abs(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))) / 2)
        return float(self.w * self.h)


@dataclass
class PatchData:
    positions: np.ndarray  # (n, 3) float32, asset frame, n = 3 x triangles
    uvs: np.ndarray  # (n, 2) float32, u right, v up (v = 1 is the top of the crop)
    texture: PILImage.Image  # RGBA, at most TEXTURE_MAX a side
    labels: np.ndarray  # (h, w) uint8, 1 = the finding, row 0 = the top of the crop
    crop: tuple[float, float, float, float]  # x0, y0, x1, y1 in the stored image's pixels
    direction: tuple[float, float, float]  # unit, between the normal and the camera
    size: tuple[float, float]  # horizontal and vertical extent, m


@dataclass
class Placement:
    kind: str  # point | patch | none
    center: tuple[float, float, float] | None = None
    normal: tuple[float, float, float] | None = None
    part: str | None = None
    coverage: float | None = None
    patch: PatchData | None = None
    derived: Derived | None = None


def camera_rays(pose, px, py, image_size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rays through image points. `px, py` are continuous pixel coordinates of the stored image
    (0 at the left/top edge, W/H at the right/bottom edge), so NDC is `px / W * 2 - 1` and
    `1 - py / H * 2`. Direction = f + x tan(hfov/2) r + y tan(vfov/2) u. Returns (origins,
    unit directions, forward)."""
    W, H = image_size
    C = np.asarray(pose.position, float)
    f = np.asarray(pose.target, float) - C
    f /= np.linalg.norm(f)
    r = np.cross(f, np.asarray(pose.up if pose.up is not None else (0.0, 1.0, 0.0), float))
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    x = np.asarray(px, float) / W * 2 - 1
    y = 1 - np.asarray(py, float) / H * 2
    th = math.tan(math.radians(pose.hfov_deg / 2))
    tv = math.tan(math.radians(pose.vfov_deg / 2))
    d = f[None, :] + x[:, None] * th * r[None, :] + y[:, None] * tv * u[None, :]
    d /= np.linalg.norm(d, axis=1)[:, None]
    return np.repeat(C[None, :], len(d), 0), d, f


def cast(mesh, origins: np.ndarray, directions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """First hits: (n, 3) points with NaN for a miss, and (n,) face indices with -1 for a miss
    (`app.asset_review.raycast`, numpy only)."""
    t, face = raycast.first_hits(mesh.vertices, mesh.faces, origins, directions)
    hits = np.full((len(origins), 3), np.nan)
    hit = face >= 0
    hits[hit] = origins[hit] + directions[hit] * t[hit, None]
    return hits, face


def wants_patch(shape: SightingShape, placement: str) -> bool:
    """The mixed rule: a polygon gives a patch, anything else a pin. A point is always a pin."""
    if shape.kind == "point" or placement not in ("patch", "mixed"):
        return False
    return placement == "patch" or shape.kind == "polygon"


def _central_grid(bbox: tuple[float, float, float, float]) -> tuple[np.ndarray, np.ndarray]:
    """POINT_GRID x POINT_GRID image points over the central half of the box."""
    x0, y0, x1, y1 = bbox
    gx, gy = np.meshgrid(
        np.linspace(x0 + (x1 - x0) * 0.25, x1 - (x1 - x0) * 0.25, POINT_GRID),
        np.linspace(y0 + (y1 - y0) * 0.25, y1 - (y1 - y0) * 0.25, POINT_GRID),
    )
    return gx.ravel(), gy.ravel()


def _grid_size(grid: int, bbox: tuple[float, float, float, float]) -> tuple[int, int]:
    """The kit's patch grid: `grid` columns, and rows by the box's aspect, from 2 to 2 x grid."""
    x0, y0, x1, y1 = bbox
    gh = max(2, int(round(grid * (y1 - y0) / max(1.0, x1 - x0))))
    return grid, min(gh, grid * 2)


def _patch_grid(bbox: tuple[float, float, float, float], gw: int, gh: int) -> tuple[np.ndarray, np.ndarray]:
    """gw x gh image points over the whole box, row-major from the top-left corner."""
    x0, y0, x1, y1 = bbox
    U, V = np.meshgrid(np.linspace(0, 1, gw), np.linspace(0, 1, gh))
    return (x0 + U * (x1 - x0)).ravel(), (y0 + V * (y1 - y0)).ravel()


def _pin(mesh, hits: np.ndarray, tri: np.ndarray, origins: np.ndarray, fwd: np.ndarray):
    """The median-distance hit, its face and that face's normal turned toward the camera; None
    when no ray hit."""
    ok = ~np.isnan(hits[:, 0])
    if not ok.any():
        return None
    dist = np.linalg.norm(hits[ok] - origins[ok], axis=1)
    k = int(np.argsort(dist)[len(dist) // 2])
    t = int(tri[ok][k])
    n = np.asarray(mesh.face_normals[t], float).copy()
    if np.dot(n, -fwd) < 0:
        n = -n
    return hits[ok][k], t, n


def _common(mesh, pin, face_node, review, frame, coverage: float) -> dict:
    """Centre, normal, the hit node's component (`mesh.metadata["node_names"]`, J1), coverage and
    the derived height, bearing, side and zone."""
    c, t, n = pin
    name = mesh.metadata.get("node_names", {}).get(int(face_node[t]))
    center = (float(c[0]), float(c[1]), float(c[2]))
    normal = (float(n[0]), float(n[1]), float(n[2]))
    return {
        "center": center,
        "normal": normal,
        "part": component_name(name, review.component_map),
        "coverage": coverage,
        "derived": derive(center, normal, review, frame),
    }


def place_sighting(
    mesh,
    face_node: np.ndarray,
    pose,
    shape: SightingShape,
    image_size: tuple[int, int],
    review,
    photo: PILImage.Image | None,
    colour: str,
    *,
    frame,
) -> Placement:
    """One sighting onto the mesh (module docstring). `photo` is the preview-size photo (only read
    for a polygon patch); `colour` is the severity colour as `#rrggbb`. Every ray of the sighting,
    the pin grid and the patch grid, goes to the mesh in one `cast`."""
    W, H = image_size
    bbox = shape.bbox(image_size)
    coverage = shape.area() / (W * H)
    px, py = _central_grid(bbox)
    patch = wants_patch(shape, review.placement)
    gw = gh = 0
    if patch:
        gw, gh = _grid_size(int(review.patch_grid or DEFAULT_PATCH_GRID), bbox)
        qx, qy = _patch_grid(bbox, gw, gh)
        px, py = np.concatenate([px, qx]), np.concatenate([py, qy])
    origins, dirs, fwd = camera_rays(pose, px, py, image_size)
    hits, tri = cast(mesh, origins, dirs)
    n0 = POINT_GRID * POINT_GRID
    pin = _pin(mesh, hits[:n0], tri[:n0], origins[:n0], fwd)
    if pin is None:
        return Placement(kind="none", coverage=coverage)
    common = _common(mesh, pin, face_node, review, frame, coverage)
    if not patch:
        return Placement(kind="point", **common)
    data = _patch(hits[n0:].reshape(gh, gw, 3), gw, gh, fwd, pin[2], frame.height_m)
    if data is None:  # the kit leaves a patch with no surviving quad unmapped
        return Placement(kind="none", coverage=coverage)
    positions, uvs, direction, size = data
    texture, labels = patch_texture(shape, image_size, photo, colour)
    return Placement(
        kind="patch", patch=PatchData(positions, uvs, texture, labels, bbox, direction, size), **common
    )


def _patch(P3: np.ndarray, gw: int, gh: int, fwd: np.ndarray, n: np.ndarray, height_m: float):
    """Quads from adjacent grid hits (kit `project.run`), as triangles; None when none survive."""
    steps = np.linalg.norm(np.diff(P3, axis=1), axis=2)
    steps = steps[np.isfinite(steps)]
    if steps.size == 0:
        return None
    thr = max(float(np.median(steps)) * EDGE_FACTOR, 1e-3)
    q = np.stack([P3[:-1, :-1], P3[:-1, 1:], P3[1:, 1:], P3[1:, :-1]], axis=2)  # (gh-1, gw-1, 4, 3)
    finite = np.isfinite(q).all(axis=(2, 3))
    with np.errstate(invalid="ignore"):
        edges = np.linalg.norm(q - np.roll(q, -1, axis=2), axis=3).max(axis=2)
        keep = finite & (edges <= thr)
    if not keep.any():
        return None
    us, vs = np.linspace(0, 1, gw), np.linspace(0, 1, gh)
    j, i = np.nonzero(keep)  # row-major: the kit's loop order
    quv = np.stack(
        [
            np.stack([us[i], 1 - vs[j]], axis=1),
            np.stack([us[i + 1], 1 - vs[j]], axis=1),
            np.stack([us[i + 1], 1 - vs[j + 1]], axis=1),
            np.stack([us[i], 1 - vs[j + 1]], axis=1),
        ],
        axis=1,
    )  # (k, 4, 2)
    order = [0, 1, 2, 0, 2, 3]  # two triangles per quad
    off = -fwd * height_m * OFFSET_FRACTION
    positions = (q[keep][:, order, :] + off).reshape(-1, 3).astype(np.float32)
    uvs = quv[:, order, :].reshape(-1, 2).astype(np.float32)
    ext = positions.max(0) - positions.min(0)
    d = n - fwd
    direction = tuple(float(v) for v in d / np.linalg.norm(d))
    size = (float(np.hypot(ext[0], ext[2])), float(ext[1]))
    return positions, uvs, direction, size


def _rgb(colour: str) -> tuple[int, int, int]:
    h = colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _fit(w: float, h: float, limit: int) -> tuple[int, int]:
    s = min(1.0, limit / max(w, h, 1.0))
    return max(1, int(round(w * s))), max(1, int(round(h * s)))


def _mask(outline, bbox, size: tuple[int, int]) -> np.ndarray:
    x0, y0, x1, y1 = bbox
    w, h = size
    sx, sy = w / max(x1 - x0, 1e-9), h / max(y1 - y0, 1e-9)
    im = PILImage.new("L", size, 0)
    ImageDraw.Draw(im).polygon([((px - x0) * sx, (py - y0) * sy) for px, py in outline], fill=1)
    return np.asarray(im, dtype=np.uint8)


def patch_texture(
    shape: SightingShape, image_size: tuple[int, int], photo: PILImage.Image | None, colour: str
) -> tuple[PILImage.Image, np.ndarray]:
    """The texture (RGBA, at most 512 px) and label grid (uint8, at most 128 px) for the box crop.

    With an outline: inside it, the photo crop with the colour mixed over it (plain colour without
    a photo), alpha 230; outside, transparent. Without one: the kit's tinted box, alpha 110, with a
    solid border. Sizes follow the crop at preview resolution, so a small box is never blown up."""
    W, H = image_size
    bbox = x0, y0, x1, y1 = shape.bbox(image_size)
    s = min(1.0, PREVIEW_SIDE / max(W, H))
    cw, ch = max(1.0, (x1 - x0) * s), max(1.0, (y1 - y0) * s)
    tw, th = _fit(cw, ch, TEXTURE_MAX)
    lw, lh = _fit(cw, ch, LABEL_MAX)
    rgb = np.array(_rgb(colour), np.float32)
    outline = shape.outline()
    if outline is None:
        a = np.zeros((th, tw, 4), np.uint8)
        a[..., :3] = rgb.astype(np.uint8)
        a[..., 3] = TINT_ALPHA
        bw = max(2, min(tw, th) // 20)
        a[:bw, :, 3] = a[-bw:, :, 3] = a[:, :bw, 3] = a[:, -bw:, 3] = 255
        return PILImage.fromarray(a, "RGBA"), np.ones((lh, lw), np.uint8)
    inside = _mask(outline, bbox, (tw, th))
    if photo is not None:
        px, py = photo.width / W, photo.height / H
        crop = photo.crop((x0 * px, y0 * py, x1 * px, y1 * py)).convert("RGB")
        base = np.asarray(crop.resize((tw, th), PILImage.BILINEAR), np.float32)
    else:
        base = np.broadcast_to(rgb, (th, tw, 3))
    fill = base * (1 - FILL_MIX) + rgb * FILL_MIX
    a = np.zeros((th, tw, 4), np.uint8)
    a[..., :3] = np.where(inside[..., None] == 1, fill, 0).astype(np.uint8)
    a[..., 3] = inside * FILL_ALPHA
    return PILImage.fromarray(a, "RGBA"), _mask(outline, bbox, (lw, lh))


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def encode_patch(positions: np.ndarray, uvs: np.ndarray) -> bytes:
    """`<sighting>.bin` (U1's format), little-endian: uint32 vertex count n, then n x 3 float32
    positions, then n x 2 float32 uvs. 4 + 20 n bytes."""
    n = int(len(positions))
    if len(uvs) != n:
        raise ValueError("a patch needs one uv per vertex")
    return (
        struct.pack("<I", n)
        + np.ascontiguousarray(positions, "<f4").tobytes()
        + np.ascontiguousarray(uvs, "<f4").tobytes()
    )


def decode_patch(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    (n,) = struct.unpack_from("<I", data, 0)
    if len(data) != 4 + 20 * n:
        raise ValueError("not a Kestrel patch file")
    pos = np.frombuffer(data, "<f4", n * 3, 4).reshape(n, 3)
    uv = np.frombuffer(data, "<f4", n * 2, 4 + 12 * n).reshape(n, 2)
    return pos, uv


def encode_labels(labels: np.ndarray) -> bytes:
    """`<sighting>.lbl` (U1's format), little-endian: uint16 width, uint16 height, then width x
    height uint8 (0 or 1), row-major, row 0 = the top of the crop (uv v = 1). 4 + w h bytes."""
    h, w = labels.shape
    return struct.pack("<HH", w, h) + np.ascontiguousarray(labels, np.uint8).tobytes()


def decode_labels(data: bytes) -> np.ndarray:
    w, h = struct.unpack_from("<HH", data, 0)
    if len(data) != 4 + w * h:
        raise ValueError("not a Kestrel label file")
    return np.frombuffer(data, np.uint8, w * h, 4).reshape(h, w)


def write_patch(dir: Path, sighting_id: str, patch: PatchData) -> str:
    """Write `<sighting>.bin`, `.png` and `.lbl` into `dir`, each atomically; returns the `.bin`
    path. The `.bin` goes last: when it is there, all three are."""
    d = Path(dir)
    d.mkdir(parents=True, exist_ok=True)
    png = io.BytesIO()
    patch.texture.save(png, "PNG")
    _atomic_write(d / f"{sighting_id}.png", png.getvalue())
    _atomic_write(d / f"{sighting_id}.lbl", encode_labels(patch.labels))
    bin_path = d / f"{sighting_id}.bin"
    _atomic_write(bin_path, encode_patch(patch.positions, patch.uvs))
    return str(bin_path)


def index_entry(patch: PatchData) -> dict:
    return {
        "vertex_count": int(len(patch.positions)),
        "texture_size": [patch.texture.width, patch.texture.height],
        "label_size": [int(patch.labels.shape[1]), int(patch.labels.shape[0])],
        "crop": [round(v, 2) for v in patch.crop],
        "direction": [round(v, 5) for v in patch.direction],
        "size": [round(v, 4) for v in patch.size],
    }


def read_index(dir: Path) -> dict:
    """`index.json`'s `items` (sighting id -> entry); {} when absent or unreadable (it is derived)."""
    try:
        data = json.loads((Path(dir) / INDEX_NAME).read_text("utf-8"))
        return dict(data.get("items") or {})
    except (OSError, ValueError, AttributeError):
        return {}


def write_index(dir: Path, asset_model_id: str, version: int, items: dict) -> None:
    body = {"format": PATCH_FORMAT, "asset_model_id": asset_model_id, "version": int(version), "items": items}
    _atomic_write(Path(dir) / INDEX_NAME, json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
