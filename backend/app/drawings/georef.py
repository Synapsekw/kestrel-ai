"""Control-point georeferencing of drawings (spec 2026-09-26-map-workspace §8.3).

A transform is six numbers [a, b, c, d, e, f]:  E = a*x + b*y + c,  N = d*x + e*y + f, from drawing
coordinates (x, y) to the destination CRS (E, N) - for every placement method (M-C0 ruling 17).
Raster sources use x = col, y = -row, so both spaces are y-up and a similarity never needs a
reflection. Closed-form least squares on centred coordinates, in plain Python so that
frontend/src/mapws/georef/fit.ts (M-W5) is a line-for-line port; both are pinned by
contract/fixtures/georef-fit-vectors.json. Pure: no I/O. `apply` also takes numpy arrays.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

Transform = tuple[float, float, float, float, float, float]

MIN_POINTS: dict[str, int] = {"similarity": 2, "affine": 3}
MAX_POINTS = 12
RMSE_HIGH_M = 0.25
SCALE_TOLERANCE = 0.02
SHEAR_SV_TOLERANCE = 0.02
SHEAR_ANGLE_DEG = 1.0
DEGENERATE_EPS = 1e-18
COLLINEAR_RATIO = 1e-12
MIN_SCALE = 1e-12
MIRROR_RMSE_RATIO = 0.5
MIRRORED = "Points picked in mirrored order"


class GeorefRefused(Exception):
    """A fit that cannot be made; the API answers 422 with `code`."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class GeorefWarning:
    code: str
    message: str


@dataclass(frozen=True)
class Fit:
    model: str
    transform: Transform
    residuals_m: list[float]
    rmse_m: float
    warnings: list[GeorefWarning] = field(default_factory=list)
    scale: float = 1.0
    rotation_deg: float = 0.0

    def to_json(self) -> dict:
        return {
            "model": self.model,
            "transform": list(self.transform),
            "rmse_m": self.rmse_m,
            "residuals_m": list(self.residuals_m),
            "warnings": [{"code": w.code, "message": w.message} for w in self.warnings],
            "scale": self.scale,
            "rotation_deg": self.rotation_deg,
        }


def apply(t, x, y):
    return t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]


def invert(t: Transform) -> Transform:
    a, b, c, d, e, f = t
    det = a * e - b * d
    if det == 0:
        raise GeorefRefused("degenerate", "this placement has no inverse")
    ia, ib, id_, ie = e / det, -b / det, -d / det, a / det
    return (ia, ib, -(ia * c + ib * f), id_, ie, -(id_ * c + ie * f))


def compose(outer: Transform, inner: Transform) -> Transform:
    """outer(inner(p))."""
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + b1 * d2,
        a1 * b2 + b1 * e2,
        a1 * c2 + b1 * f2 + c1,
        d1 * a2 + e1 * d2,
        d1 * b2 + e1 * e2,
        d1 * c2 + e1 * f2 + f1,
    )


def scale_of(t: Transform) -> float:
    """The mean axis length: dst units per drawing unit (the contract's GeorefFit.scale)."""
    return (math.hypot(t[0], t[3]) + math.hypot(t[1], t[4])) / 2


def rotation_of(t: Transform) -> float:
    return math.degrees(math.atan2(t[3], t[0]))


def parse_preview(text: str) -> Transform:
    """`a,b,c,d,e,f` from a tile request's `t` query (drawing -> site); mirrored or singular refused."""
    try:
        vals = tuple(float(v) for v in text.split(","))
    except ValueError:
        vals = ()
    if (
        len(vals) != 6
        or not all(math.isfinite(v) for v in vals)
        or vals[0] * vals[4] - vals[1] * vals[3] <= 0
    ):
        raise GeorefRefused("invalid_preview", "t must be six finite numbers a,b,c,d,e,f with a*e - b*d > 0")
    return vals  # type: ignore[return-value]


def _affine(u, v) -> tuple[float, float, float, float] | None:
    gxx = sum(p * p for p, _ in u)
    gxy = sum(p * q for p, q in u)
    gyy = sum(q * q for _, q in u)
    tr, det = gxx + gyy, gxx * gyy - gxy * gxy
    root = math.sqrt(max(tr * tr - 4 * det, 0.0))
    if (tr - root) / 2 <= COLLINEAR_RATIO * (tr + root) / 2:
        return None
    hx0 = sum(p * r for (p, _), (r, _) in zip(u, v, strict=True))
    hy0 = sum(q * r for (_, q), (r, _) in zip(u, v, strict=True))
    hx1 = sum(p * s for (p, _), (_, s) in zip(u, v, strict=True))
    hy1 = sum(q * s for (_, q), (_, s) in zip(u, v, strict=True))
    return (
        (gyy * hx0 - gxy * hy0) / det,
        (gxx * hy0 - gxy * hx0) / det,
        (gyy * hx1 - gxy * hy1) / det,
        (gxx * hy1 - gxy * hx1) / det,
    )


def _sheared(a: float, b: float, d: float, e: float) -> bool:
    s = a * a + b * b + d * d + e * e
    det = a * e - b * d
    q = math.sqrt(max(s * s - 4 * det * det, 0.0))
    s1, s2 = math.sqrt((s + q) / 2), math.sqrt(max((s - q) / 2, 0.0))
    if s2 == 0 or s1 / s2 - 1 > SHEAR_SV_TOLERANCE:
        return True
    cos = abs(a * b + d * e) / (math.hypot(a, d) * math.hypot(b, e))
    return abs(90.0 - math.degrees(math.acos(min(1.0, cos)))) > SHEAR_ANGLE_DEG


def _degenerate(what: str) -> GeorefRefused:
    return GeorefRefused("degenerate", f"The {what} points are all in one place; pick points far apart")


def _rmse_of(la: float, lb: float, c: float, ld: float, le: float, f: float, src, dst) -> float:
    """Plain (unscaled) RMSE of a linear+translation fit; used only to compare two candidate
    fits, so the destination unit cancels and is left out."""
    residuals = [
        math.hypot(la * x + lb * y + c - big_e, ld * x + le * y + f - big_n)
        for (x, y), (big_e, big_n) in zip(src, dst, strict=True)
    ]
    return math.sqrt(sum(r * r for r in residuals) / len(residuals))


def fit(
    model: str,
    src: Sequence[Sequence[float]],
    dst: Sequence[Sequence[float]],
    *,
    dst_unit_m: float = 1.0,
    units_scale: float | None = None,
) -> Fit:
    """Least-squares `model` ("similarity" | "affine") from src to dst (the plan's normative maths)."""
    if model not in MIN_POINTS:
        raise ValueError(f"unknown model {model!r}")
    n = len(src)
    if len(dst) != n:
        raise ValueError("src and dst differ in length")
    if n < MIN_POINTS[model]:
        raise GeorefRefused(
            "too_few_points", f"{model.capitalize()} needs at least {MIN_POINTS[model]} point pairs"
        )
    if n > MAX_POINTS:
        raise GeorefRefused("too_many_points", f"At most {MAX_POINTS} point pairs can be used")
    if not all(math.isfinite(float(c)) for p in (*src, *dst) for c in p):
        raise _degenerate("drawing")
    mx, my = sum(float(p[0]) for p in src) / n, sum(float(p[1]) for p in src) / n
    ex, ey = sum(float(p[0]) for p in dst) / n, sum(float(p[1]) for p in dst) / n
    u = [(float(x) - mx, float(y) - my) for x, y in src]
    v = [(float(x) - ex, float(y) - ey) for x, y in dst]
    sxx = sum(p * p + q * q for p, q in u)
    if sxx <= DEGENERATE_EPS * n:
        raise _degenerate("drawing")
    if model == "similarity":
        alpha = sum(p * r + q * s for (p, q), (r, s) in zip(u, v, strict=True)) / sxx
        beta = sum(p * s - q * r for (p, q), (r, s) in zip(u, v, strict=True)) / sxx
        la, lb, ld, le = alpha, -beta, beta, alpha
        # n == MIN_POINTS["similarity"] (2) can never show a mirror; skip the check (fix round 1).
        if n >= 3:
            # The orientation-reversing counterpart: fit z -> a*conj(z) + c in the complex plane
            # (same closed form with the source y negated), and compare RMSE instead of the sign
            # of the unconstrained affine determinant, which noise flips on near-collinear picks.
            alpha_m = sum(p * r - q * s for (p, q), (r, s) in zip(u, v, strict=True)) / sxx
            beta_m = sum(p * s + q * r for (p, q), (r, s) in zip(u, v, strict=True)) / sxx
            la_m, lb_m, ld_m, le_m = alpha_m, beta_m, beta_m, -alpha_m
            c_direct, f_direct = ex - la * mx - lb * my, ey - ld * mx - le * my
            c_mirror, f_mirror = ex - la_m * mx - lb_m * my, ey - ld_m * mx - le_m * my
            rmse_direct = _rmse_of(la, lb, c_direct, ld, le, f_direct, src, dst)
            rmse_mirror = _rmse_of(la_m, lb_m, c_mirror, ld_m, le_m, f_mirror, src, dst)
            if rmse_mirror < MIRROR_RMSE_RATIO * rmse_direct:
                raise GeorefRefused("reflection", MIRRORED)
    else:
        aff = _affine(u, v)
        if aff is None:
            raise GeorefRefused(
                "collinear", "The points lie on one line; Affine needs points that span an area"
            )
        la, lb, ld, le = aff
    if la * le - lb * ld < 0:
        raise GeorefRefused("reflection", MIRRORED)
    scale = (math.hypot(la, ld) + math.hypot(lb, le)) / 2
    if not scale >= MIN_SCALE:  # also catches NaN
        raise _degenerate("map")
    t: Transform = (la, lb, ex - la * mx - lb * my, ld, le, ey - ld * mx - le * my)
    if n == MIN_POINTS[model]:
        residuals, rmse = [0.0] * n, 0.0
    else:
        residuals = [
            math.hypot(la * x + lb * y + t[2] - big_e, ld * x + le * y + t[5] - big_n) * dst_unit_m
            for (x, y), (big_e, big_n) in zip(src, dst, strict=True)
        ]
        rmse = math.sqrt(sum(r * r for r in residuals) / n)
    scale_m, rotation = scale * dst_unit_m, math.degrees(math.atan2(ld, la))
    if not all(math.isfinite(c) for c in (*t, rmse, scale_m, rotation)):
        raise _degenerate("drawing")
    warnings: list[GeorefWarning] = []
    if rmse > RMSE_HIGH_M:
        warnings.append(
            GeorefWarning("rmse_high", f"RMSE {rmse:.2f} m is above {RMSE_HIGH_M} m: check the points")
        )
    if units_scale is not None and abs(scale_m / units_scale - 1) > SCALE_TOLERANCE:
        warnings.append(
            GeorefWarning(
                "scale_mismatch",
                "The fitted scale differs from the drawing's units by more than 2%: wrong units or the "
                "wrong point?",
            )
        )
    if model == "affine" and _sheared(la, lb, ld, le):
        warnings.append(GeorefWarning("shear", "The fit is skewed: use Similarity unless the scan is skewed"))
    return Fit(model, t, residuals, rmse, warnings, scale_m, rotation)
