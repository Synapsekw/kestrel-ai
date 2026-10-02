# backend/app/asset_models/shapes.py
"""One mesh per shape (spec 2026-10-02 §6.2), in a local frame: millimetres, axis +Y, base at y = 0.

Rotationally symmetric shapes are a closed (r, y) profile revolved about Y, so they come out
watertight. Segment counts follow a 2 mm chord tolerance, capped, so a large shell stays light.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from shapely.geometry import Point, Polygon

from app.asset_models import spec as s

CHORD_TOL_MM = 0.5  # spec says 2 mm, but that loses 2.5 % of a r=100 lathe disc; the test pins 1 %
MIN_SEG, MAX_SEG = 16, 256
HEAD_STEPS = 48  # profile samples along a head's meridian
# trimesh.creation.revolve spins about Z; this turns its +Z into our +Y (and its +Y into -Z).
_Z_TO_Y = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])


def segments_for(radius_mm: float) -> int:
    if radius_mm <= CHORD_TOL_MM:
        return MIN_SEG
    n = math.ceil(math.pi / math.acos(1 - CHORD_TOL_MM / radius_mm))
    return max(MIN_SEG, min(MAX_SEG, n))


def _revolve(profile_ry: list[tuple[float, float]], sweep_deg: float = 360.0) -> trimesh.Trimesh:
    """Revolve a closed (r, y) polygon about Y. The polygon is given open; it is closed here."""
    pts = np.asarray(profile_ry, dtype=float)
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    r_max = float(pts[:, 0].max())
    sections = max(4, round(segments_for(r_max) * sweep_deg / 360))
    angle = None if sweep_deg >= 360 else math.radians(sweep_deg)
    mesh = trimesh.creation.revolve(pts, angle=angle, sections=sections)
    mesh.apply_transform(_Z_TO_Y)
    mesh.fix_normals()
    return mesh


# ------------------------------------------------------------------ head profiles (inner surface)
def _head_profile(p) -> tuple[list[tuple[float, float]], float]:
    """(r, y) samples of a head's inner meridian from the axis (r = 0) to the tangent line (y = 0),
    and the crown height. The outer surface uses the same function on the thickened head."""
    a = p.id / 2
    if isinstance(p, s.TorisphericalParams):
        R, r = p.crown_r, p.knuckle_r
        ka = a - r  # knuckle centre radius
        yc = -math.sqrt(max((R - r) ** 2 - ka**2, 0.0))  # crown centre height
        sin_alpha = ka / (R - r)
        r_split = R * sin_alpha

        def y(x):
            if x <= r_split:
                return yc + math.sqrt(max(R**2 - x**2, 0.0))
            return math.sqrt(max(r**2 - (x - ka) ** 2, 0.0))

        h = yc + R
    elif isinstance(p, s.EllipsoidalParams):
        h = a / p.ratio

        def y(x):
            return h * math.sqrt(max(1 - (x / a) ** 2, 0.0))
    else:  # hemispherical
        h = a

        def y(x):
            return math.sqrt(max(a**2 - x**2, 0.0))

    xs = [a * math.sin(t) for t in np.linspace(0, math.pi / 2, HEAD_STEPS)]
    return [(x, y(x)) for x in xs], h


def _thickened(p):
    """The same head grown outward by its thickness (exact offset for spheres and tori)."""
    t = p.thickness
    if isinstance(p, s.TorisphericalParams):
        return p.model_copy(
            update={"id": p.id + 2 * t, "crown_r": p.crown_r + t, "knuckle_r": p.knuckle_r + t}
        )
    if isinstance(p, s.EllipsoidalParams):
        # keep the outer height = inner height + t
        a_out = p.id / 2 + t
        h_out = p.id / 2 / p.ratio + t
        return p.model_copy(update={"id": 2 * a_out, "ratio": a_out / h_out})
    return p.model_copy(update={"id": p.id + 2 * t})


def head_height(p) -> float:
    return _head_profile(p)[1]


def head_surface_y(p, r_mm: float) -> float:
    """Outer surface height above the tangent line at radius r (for head-mounted parts)."""
    if isinstance(p, s.FlatPlateParams):
        rise = (p.d / 2 - min(r_mm, p.d / 2)) / p.slope if p.slope else 0.0
        return rise + p.thickness
    outer, _ = _head_profile(_thickened(p))
    rs = np.array([q[0] for q in outer])
    ys = np.array([q[1] for q in outer])
    y = float(np.interp(min(r_mm, rs[-1]), rs, ys))
    return -y if p.facing == "down" else y


def _head(p) -> trimesh.Trimesh:
    inner, _ = _head_profile(p)
    outer, _ = _head_profile(_thickened(p))
    # closed meridian: outer from axis to rim, then inner from rim back to axis
    poly = [(0.0, outer[0][1])] + outer[1:] + list(reversed(inner[1:])) + [(0.0, inner[0][1])]
    mesh = _revolve(poly)
    if p.facing == "down":
        mesh.apply_transform(np.diag([1, -1, 1, 1]))  # trimesh flips the winding for a reflection
    return mesh


# ------------------------------------------------------------------ builders
def _cylinder(p: s.CylinderParams):
    ri, ro = p.id / 2, p.id / 2 + p.thickness
    return _revolve([(ri, 0), (ro, 0), (ro, p.height), (ri, p.height)], p.sweep_deg)


def _cone(p: s.ConeParams):
    rb, rt, t = p.d_bottom / 2, p.d_top / 2, p.thickness
    return _revolve([(max(rb - t, 0), 0), (rb, 0), (rt, p.height), (max(rt - t, 0), p.height)])


def _flat_plate(p: s.FlatPlateParams):
    if p.d is None:
        return _box(s.BoxParams(w=p.w, l=p.l, h=p.thickness))
    R = p.d / 2
    rise = R / p.slope if p.slope else 0.0  # cone-up: the centre is higher than the rim
    return _revolve([(0, rise), (R, 0), (R, p.thickness), (0, rise + p.thickness)])


def _box(p: s.BoxParams):
    m = trimesh.creation.box(extents=[p.w, p.h, p.l])
    m.apply_translation([0, p.h / 2, 0])
    return m


def _nozzle(p: s.NozzleParams):
    wall = max(3.0, p.od * 0.05)
    ro, ri = p.od / 2, max(p.od / 2 - wall, 0.5)
    neck_h = p.projection - p.flange_t
    pieces = [_revolve([(ri, 0), (ro, 0), (ro, neck_h), (ri, neck_h)])]
    fo = p.flange_od / 2
    inner = 0.0 if p.blind else ri
    pieces.append(_revolve([(inner, neck_h), (fo, neck_h), (fo, p.projection), (inner, p.projection)]))
    return trimesh.util.concatenate(pieces)


def _pipe_run(p: s.PipeRunParams):
    r = p.od / 2
    pts = np.asarray(p.points_mm, dtype=float)
    seg = segments_for(r)
    pieces = [
        trimesh.creation.cylinder(radius=r, segment=[a, b], sections=seg)
        for a, b in zip(pts[:-1], pts[1:], strict=True)
        if np.linalg.norm(b - a) > 1e-6
    ]
    for q in pts:  # joints and ends
        ball = trimesh.creation.icosphere(subdivisions=2, radius=r)
        ball.apply_translation(q)
        pieces.append(ball)
    return trimesh.util.concatenate(pieces)


def _lathe(p: s.LatheParams):
    return _revolve([tuple(q) for q in p.profile_mm], p.sweep_deg)


def _extrusion(p: s.ExtrusionParams):
    # outline is in plan (x north, z east); extrude_polygon builds along +Z from a polygon in XY
    m = trimesh.creation.extrude_polygon(Polygon(p.outline_mm), p.height)
    m.apply_transform(_Z_TO_Y)
    return m


def _sweep(p: s.SweepParams):
    if p.section == "circle":
        section = Point(0, 0).buffer(p.r, quad_segs=max(8, segments_for(p.r) // 4))
    else:
        section = Polygon(
            [(-p.w / 2, -p.h / 2), (p.w / 2, -p.h / 2), (p.w / 2, p.h / 2), (-p.w / 2, p.h / 2)]
        )
    return trimesh.creation.sweep_polygon(section, np.asarray(p.path_mm, dtype=float))


_BUILDERS = {
    "cylinder": _cylinder,
    "cone": _cone,
    "head_torispherical": _head,
    "head_ellipsoidal": _head,
    "head_hemispherical": _head,
    "flat_plate": _flat_plate,
    "box": _box,
    "nozzle": _nozzle,
    "pipe_run": _pipe_run,
    "lathe": _lathe,
    "extrusion": _extrusion,
    "sweep": _sweep,
}


def build_shape(shape: str, params) -> trimesh.Trimesh:
    return _BUILDERS[shape](params)
