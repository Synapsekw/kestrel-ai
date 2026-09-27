"""Measurement formulas (S1 spec §9.3; workspace spec 2026-09-26 §8.2), identical to
frontend/src/clouds/measure.ts.

Both are pinned by contract/fixtures/cloud-measure-vectors.json to 1e-9: the S1 kinds by `fields`/
`cases`, areas by `area_fields`/`area_cases`, rings by `ring_fields`/`ring_cases`, and the refusals
by `refusal_cases`. For picks A and B: d = B - A, u = sqrt(uA^2 + uB^2). A vertical check sorts its
picks by Z (A lower, B upper). Pure `math` only, so the TypeScript mirror stays line for line.
"""

from __future__ import annotations

import math

FIELDS = [
    "lon",
    "lat",
    "dx",
    "dy",
    "dz",
    "distance_3d",
    "distance_horizontal",
    "distance_vertical",
    "height_difference",
    "lean_offset_m",
    "lean_angle_deg",
    "lean_azimuth_deg",
    "lean_mm_per_m",
    "uncertainty_m",
    "angle_uncertainty_deg",
]
MIN_VERTICAL_SPAN_M = 0.5


def ordered(kind: str, points: list[dict]) -> list[dict]:
    if kind == "vertical" and len(points) == 2 and points[1]["z"] < points[0]["z"]:
        return [points[1], points[0]]
    return list(points)


def results(kind: str, points: list[dict]) -> dict[str, float | None]:
    out: dict[str, float | None] = dict.fromkeys(FIELDS)
    if kind == "point":
        out["uncertainty_m"] = float(points[0]["uncertainty_m"])
        return out
    a, b = ordered(kind, points)
    dx, dy, dz = b["x"] - a["x"], b["y"] - a["y"], b["z"] - a["z"]
    u = math.sqrt(a["uncertainty_m"] ** 2 + b["uncertainty_m"] ** 2)
    h = math.hypot(dx, dy)
    out.update(
        dx=dx,
        dy=dy,
        dz=dz,
        distance_3d=math.sqrt(dx * dx + dy * dy + dz * dz),
        distance_horizontal=h,
        distance_vertical=abs(dz),
        height_difference=dz,
        uncertainty_m=u,
    )
    if kind == "vertical":
        span = abs(dz)
        out.update(
            lean_offset_m=h,
            lean_angle_deg=math.degrees(math.atan2(h, span)),
            lean_azimuth_deg=(math.atan2(dx, dy) * 180 / math.pi + 360) % 360,
            lean_mm_per_m=1000 * h / span,
            angle_uncertainty_deg=math.degrees(math.atan(u / span)),
        )
    return out


# ------------------------------------------------ area and rings (2026-09-26 workspace spec §8.2)
# Pinned by the `area_*`, `ring_*` and `refusal_cases` keys of the same vectors file.

AREA_FIELDS = [
    "area_m2",
    "area_surface_m2",
    "area_plan_m2",
    "perimeter_m",
    "plane_rms_m",
    "plane_tilt_deg",
    "plane_azimuth_deg",
    "uncertainty_m2",
]
RING_FIELDS = ["ring_radius_lower_m", "ring_radius_upper_m", "ring_rms_lower_m", "ring_rms_upper_m"]
PROFILE_FIELDS = [
    "profile_length_m",
    "profile_z_min",
    "profile_z_max",
    "profile_width_max_m",
    "profile_point_count",
]
MIN_AREA_M2 = 1e-4
MAX_AREA_VERTICES = 200
SAME_POINT_M = 1e-6

Vec = tuple[float, float, float]


class Refusal(Exception):
    """A geometry the server refuses with 422 `code`; measurements.py turns it into an AppError."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _xyz(p: dict) -> Vec:
    return (float(p["x"]), float(p["y"]), float(p["z"]))


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


TOO_LARGE = "these coordinates are too large to measure"


def _finite(out: dict[str, float | None], code: str) -> dict[str, float | None]:
    """Coordinates so large that the products overflow give inf/nan: refused, never a 500.

    The area and rings code squares with `x * x`, never `x ** 2`: a Python float `**` raises
    OverflowError where `*` gives inf (as in JavaScript), and inf is what this check refuses."""
    if all(v is None or math.isfinite(v) for v in out.values()):
        return out
    raise Refusal(code, TOO_LARGE)


def area_vertices(points: list[dict]) -> list[dict]:
    """The outline as stored: closed implicitly, so trailing repeats of the first vertex are dropped."""
    pts = list(points)
    while len(pts) >= 2 and _norm(_sub(_xyz(pts[-1]), _xyz(pts[0]))) <= SAME_POINT_M:
        pts.pop()
    return pts


def _orient(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _within(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> bool:
    return min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= c[1] <= max(a[1], b[1])


def _segments_touch(p1, p2, p3, p4, eps: float) -> bool:
    d1, d2 = _orient(p3, p4, p1), _orient(p3, p4, p2)
    d3, d4 = _orient(p1, p2, p3), _orient(p1, p2, p4)
    if ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and (
        (d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps)
    ):
        return True
    return (
        (abs(d1) <= eps and _within(p3, p4, p1))
        or (abs(d2) <= eps and _within(p3, p4, p2))
        or (abs(d3) <= eps and _within(p1, p2, p3))
        or (abs(d4) <= eps and _within(p1, p2, p4))
    )


def _self_intersects(q: list[tuple[float, float]]) -> bool:
    """Two non-adjacent edges touching, or an edge folding back over the previous one (a spike)."""
    n = len(q)
    scale = max(1.0, max(max(abs(x), abs(y)) for x, y in q))
    eps = 1e-12 * scale * scale
    for i in range(n):
        a, b, c = q[i], q[(i + 1) % n], q[(i + 2) % n]
        if abs(_orient(a, b, c)) <= eps and (c[0] - b[0]) * (a[0] - b[0]) + (c[1] - b[1]) * (a[1] - b[1]) > 0:
            return True
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # edges n-1 and 0 share vertex 0
            if _segments_touch(a, b, q[j], q[(j + 1) % n], eps):
                return True
    return False


def area_results(points: list[dict], params: dict | None) -> dict[str, float | None]:
    """Newell area of the outline, translated to its centroid first (float cancellation at UTM)."""
    pts = area_vertices(points)
    n = len(pts)
    if not 3 <= n <= MAX_AREA_VERTICES:
        raise Refusal("wrong_point_count", "an area needs 3 to 200 vertices")
    p = [_xyz(v) for v in pts]
    c = (sum(v[0] for v in p) / n, sum(v[1] for v in p) / n, sum(v[2] for v in p) / n)
    q = [_sub(v, c) for v in p]
    if any(_norm(_sub(q[(i + 1) % n], q[i])) <= SAME_POINT_M for i in range(n)):
        raise Refusal("degenerate_polygon", "two consecutive vertices are the same point")
    sx = sy = sz = perimeter = 0.0
    for i in range(n):
        a, b = q[i], q[(i + 1) % n]
        cx, cy, cz = _cross(a, b)
        sx, sy, sz = sx + cx, sy + cy, sz + cz
        perimeter += _norm(_sub(b, a))
    big_n = (sx / 2, sy / 2, sz / 2)
    surface = _norm(big_n)
    if not (math.isfinite(surface) and math.isfinite(perimeter)):
        raise Refusal("degenerate_polygon", TOO_LARGE)
    if surface < MIN_AREA_M2:
        raise Refusal(
            "degenerate_polygon", "the outline has no area (less than 1 cm²); pick vertices around a surface"
        )
    nhat = (big_n[0] / surface, big_n[1] / surface, big_n[2] / surface)
    helper = (1.0, 0.0, 0.0) if abs(nhat[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = _cross(helper, nhat)
    e1 = (e1[0] / _norm(e1), e1[1] / _norm(e1), e1[2] / _norm(e1))
    e2 = _cross(nhat, e1)
    if _self_intersects([(_dot(v, e1), _dot(v, e2)) for v in q]):
        raise Refusal(
            "self_intersecting", "the outline crosses itself; pick the vertices in order around the area"
        )
    view = (params or {}).get("view_dir")
    facing = nhat
    if view is not None and _norm(tuple(view)) > 0:
        if _dot(nhat, tuple(view)) > 0:  # the normal points away from the camera: turn it towards it
            facing = (-nhat[0], -nhat[1], -nhat[2])
    elif nhat[2] < 0:  # no camera: the upward normal; a wall (n_z == 0) keeps the outline's winding
        facing = (-nhat[0], -nhat[1], -nhat[2])
    horizontal = math.hypot(facing[0], facing[1])
    azimuth = None if horizontal < 1e-12 else (math.degrees(math.atan2(facing[0], facing[1])) + 360) % 360
    plan = abs(big_n[2])
    u_rms = math.sqrt(sum(float(v["uncertainty_m"]) * float(v["uncertainty_m"]) for v in pts) / n)
    mode = (params or {}).get("mode") or "surface"
    return _finite(
        {
            "area_m2": plan if mode == "plan" else surface,
            "area_surface_m2": surface,
            "area_plan_m2": plan,
            "perimeter_m": perimeter,
            "plane_rms_m": math.sqrt(sum(_dot(v, nhat) * _dot(v, nhat) for v in q) / n),
            "plane_tilt_deg": math.degrees(math.acos(min(1.0, abs(nhat[2])))),
            "plane_azimuth_deg": azimuth,
            "uncertainty_m2": perimeter * u_rms,
        },
        "degenerate_polygon",
    )


RING_MIN_PICKS = 3
RINGS_MAX_PICKS = 64
RING_COND_MAX = 1e8


def method_of(params: dict | None) -> str:
    """A vertical check's method: `points` (two picks, S1) unless the params say `rings`."""
    return (params or {}).get("method") or "points"


def fit_ring(points: list[dict]) -> dict[str, float]:
    """Kasa least-squares circle in XY on centred coordinates; z is the mean z of the picks."""
    k = len(points)
    mx = sum(float(p["x"]) for p in points) / k
    my = sum(float(p["y"]) for p in points) / k
    u = [float(p["x"]) - mx for p in points]
    v = [float(p["y"]) - my for p in points]
    suu = sum(a * a for a in u)
    svv = sum(b * b for b in v)
    suv = sum(a * b for a, b in zip(u, v, strict=True))
    trace, det = suu + svv, suu * svv - suv * suv
    if not all(math.isfinite(t) for t in (mx, my, suu, svv, suv, trace * trace, det)):
        raise Refusal("collinear_ring", TOO_LARGE)  # huge offsets: not "the picks lie in a line"
    disc = math.sqrt(max(trace * trace / 4 - det, 0.0))
    lmax, lmin = trace / 2 + disc, trace / 2 - disc
    if lmin <= 0 or lmax / lmin > RING_COND_MAX:
        raise Refusal(
            "collinear_ring", "the picks on a ring lie in a line; pick points spread around the ring"
        )
    w = [a * a + b * b for a, b in zip(u, v, strict=True)]
    bu = sum(a * c for a, c in zip(u, w, strict=True))
    bv = sum(b * c for b, c in zip(v, w, strict=True))
    d = -(svv * bu - suv * bv) / det
    e = -(suu * bv - suv * bu) / det
    f = -sum(w) / k
    cx, cy = mx - d / 2, my - e / 2
    r = math.sqrt(max(d * d / 4 + e * e / 4 - f, 0.0))
    off = [math.hypot(float(p["x"]) - cx, float(p["y"]) - cy) - r for p in points]
    rms = math.sqrt(sum(t * t for t in off) / k)
    mean_u2 = sum(float(p["uncertainty_m"]) * float(p["uncertainty_m"]) for p in points) / k
    return {
        "x": cx,
        "y": cy,
        "z": sum(float(p["z"]) for p in points) / k,
        "radius_m": r,
        "rms_m": rms,
        "uncertainty_m": math.sqrt(rms * rms + mean_u2 / k),
    }


def ring_axis(points: list[dict]) -> tuple[dict[str, float], dict[str, float]]:
    """The two fitted rings, lower first by z (whatever their `group` numbers say)."""
    if any(p.get("group") not in (0, 1) for p in points):
        raise Refusal(
            "ring_needs_three_points", "every ring pick needs its ring: group 0 (lower) or 1 (upper)"
        )
    groups = [[p for p in points if p["group"] == g] for g in (0, 1)]
    if min(len(g) for g in groups) < RING_MIN_PICKS:
        raise Refusal(
            "ring_needs_three_points",
            "each ring needs at least three picks (press N to start the upper ring)",
        )
    if len(points) > RINGS_MAX_PICKS:
        raise Refusal("wrong_point_count", "a rings vertical check takes 6 to 64 picks")
    lower, upper = sorted((fit_ring(g) for g in groups), key=lambda ring: ring["z"])
    return lower, upper


def rings_results(points: list[dict]) -> dict[str, float | None]:
    """The S1 vertical formulas between the two fitted centres, plus each ring's radius and RMS."""
    lower, upper = ring_axis(points)
    if upper["z"] - lower["z"] < MIN_VERTICAL_SPAN_M:
        raise Refusal("vertical_span_too_small", "pick points further apart vertically (at least 0.5 m)")
    out = results("vertical", [lower, upper])
    out.update(
        ring_radius_lower_m=lower["radius_m"],
        ring_radius_upper_m=upper["radius_m"],
        ring_rms_lower_m=lower["rms_m"],
        ring_rms_upper_m=upper["rms_m"],
    )
    return _finite(out, "collinear_ring")
