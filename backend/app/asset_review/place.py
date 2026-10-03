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

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image as PILImage

from app.asset_review import raycast
from app.asset_review.derive import Derived, component_name, derive
from app.geometry import aabb_of, corners_of

PREVIEW_SIDE = 2048  # photos are read at this long side, never the original (Global Constraints)
POINT_GRID = 5
DEFAULT_PATCH_GRID = 48  # the kit's default when a profile sets none


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
    """One sighting onto the mesh (module docstring). Pins and misses; Task 3 adds patches."""
    W, H = image_size
    bbox = shape.bbox(image_size)
    coverage = shape.area() / (W * H)
    px, py = _central_grid(bbox)
    origins, dirs, fwd = camera_rays(pose, px, py, image_size)
    hits, tri = cast(mesh, origins, dirs)
    pin = _pin(mesh, hits, tri, origins, fwd)
    if pin is None:
        return Placement(kind="none", coverage=coverage)
    return Placement(kind="point", **_common(mesh, pin, face_node, review, frame, coverage))
