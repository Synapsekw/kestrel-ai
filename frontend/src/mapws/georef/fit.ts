import type { LinearUnit } from "@/api/designSurfaces";

/**
 * The K tool's live preview fit (map workspace spec §8.3). It implements M-B3's "Fit maths
 * (normative)" step for step; backend/app/drawings/georef.py is authoritative, and both are pinned to
 * contract/fixtures/georef-fit-vectors.json. Transforms are [a, b, c, d, e, f] with
 * E = a·x + b·y + c and N = d·x + e·y + f. Raster drawings use src = (col, −row).
 *
 * The similarity reflection check is B3's RMSE-ratio rule (MIRROR_RMSE_RATIO = 0.5): for every
 * n >= 3, fit both the direct and the mirrored (orientation-reversing) candidate on the raw
 * (uncentred) coordinates and refuse if the mirrored candidate fits far better. n == 2 skips the
 * check (two points can never show a mirror).
 */
export type Vec2 = [number, number];
export type Affine = [number, number, number, number, number, number];
export type GeorefModelName = "similarity" | "affine";
export interface FitPair {
  src: Vec2;
  dst: Vec2;
}
export type FitRefusal =
  | "too_few_points"
  | "too_many_points"
  | "degenerate"
  | "collinear"
  | "reflection";
export type FitWarning = "rmse_high" | "scale_mismatch" | "shear";
export type FitResult =
  | {
      ok: true;
      transform: Affine;
      /** The mean axis length in metres per drawing unit (the contract's GeorefFit.scale). */
      scale: number;
      rotation_deg: number;
      rmse_m: number;
      residuals_m: number[];
      warnings: FitWarning[];
    }
  | { ok: false; error: FitRefusal };

export const MIN_PAIRS: Record<GeorefModelName, number> = {
  similarity: 2,
  affine: 3,
};
export const MAX_PAIRS = 12;

/** Metres per drawing unit (S3's LinearUnit): the `units_scale` of a vector drawing. */
export const UNIT_METRES: Record<LinearUnit, number> = {
  millimetre: 0.001,
  centimetre: 0.01,
  metre: 1,
  international_foot: 0.3048,
  us_survey_foot: 1200 / 3937,
};

const MIRROR_RMSE_RATIO = 0.5;

export function applyAffine(t: Affine, p: Vec2): Vec2 {
  return [t[0] * p[0] + t[1] * p[1] + t[2], t[3] * p[0] + t[4] * p[1] + t[5]];
}

export function invertAffine(t: Affine): Affine | null {
  const [a, b, c, d, e, f] = t;
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-300) return null;
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

const refuse = (error: FitRefusal): FitResult => ({ ok: false, error });

/** Plain (unscaled) RMSE of a linear+translation candidate on the raw, uncentred pairs. */
function rmseOf(
  la: number,
  lb: number,
  c: number,
  ld: number,
  le: number,
  f: number,
  pairs: readonly FitPair[],
): number {
  const n = pairs.length;
  let sum = 0;
  for (const p of pairs) {
    const ex = la * p.src[0] + lb * p.src[1] + c - p.dst[0];
    const ny = ld * p.src[0] + le * p.src[1] + f - p.dst[1];
    sum += ex * ex + ny * ny;
  }
  return Math.sqrt(sum / n);
}

export function fitGeoref(
  model: GeorefModelName,
  pairs: readonly FitPair[],
  units: { unitsScale?: number | null; dstUnitM?: number } = {},
): FitResult {
  const unitsScale = units.unitsScale ?? null;
  const dstUnitM = units.dstUnitM ?? 1;
  // 1. Count; non-finite input.
  const n = pairs.length;
  if (n < MIN_PAIRS[model]) return refuse("too_few_points");
  if (n > MAX_PAIRS) return refuse("too_many_points");
  if (!pairs.every((p) => [...p.src, ...p.dst].every(Number.isFinite)))
    return refuse("degenerate");

  // 2. Means (plain sums in index order) and centred coordinates.
  let mx = 0;
  let my = 0;
  let ex = 0;
  let ey = 0;
  for (const p of pairs) {
    mx += p.src[0];
    my += p.src[1];
    ex += p.dst[0];
    ey += p.dst[1];
  }
  mx /= n;
  my /= n;
  ex /= n;
  ey /= n;
  let S = 0;
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;
  let hx0 = 0;
  let hy0 = 0;
  let hx1 = 0;
  let hy1 = 0;
  let sa = 0;
  let sb = 0;
  // For the similarity mirror candidate (uses the same centred sums, different combination).
  let sa_m = 0;
  let sb_m = 0;
  for (const p of pairs) {
    const ux = p.src[0] - mx;
    const uy = p.src[1] - my;
    const vx = p.dst[0] - ex;
    const vy = p.dst[1] - ey;
    S += ux * ux + uy * uy;
    gxx += ux * ux;
    gxy += ux * uy;
    gyy += uy * uy;
    hx0 += ux * vx;
    hy0 += uy * vx;
    hx1 += ux * vy;
    hy1 += uy * vy;
    sa += ux * vx + uy * vy;
    sb += ux * vy - uy * vx;
    sa_m += ux * vx - uy * vy;
    sb_m += ux * vy + uy * vx;
  }

  // 3. Degenerate sources.
  if (S <= 1e-18 * n) return refuse("degenerate");

  // 4. Affine normal equations; collinear iff λmin ≤ 1e-12·λmax.
  const tr = gxx + gyy;
  const D = gxx * gyy - gxy * gxy;
  const root = Math.sqrt(Math.max(tr * tr - 4 * D, 0));
  const collinear = (tr - root) / 2 <= 1e-12 * ((tr + root) / 2);
  const affine = collinear
    ? null
    : {
        a: (gyy * hx0 - gxy * hy0) / D,
        b: (gxx * hy0 - gxy * hx0) / D,
        d: (gyy * hx1 - gxy * hy1) / D,
        e: (gxx * hy1 - gxy * hx1) / D,
      };

  // 5. Linear part.
  let a: number;
  let b: number;
  let d: number;
  let e: number;
  if (model === "similarity") {
    const alpha = sa / S;
    const beta = sb / S;
    [a, b, d, e] = [alpha, -beta, beta, alpha];
    // B3's RMSE-ratio rule (preflight PF1): for every n >= 3, compare the direct fit against the
    // orientation-reversing (mirrored) candidate on the raw, uncentred coordinates. n == 2 skips
    // (two points can never show a mirror).
    if (n >= 3) {
      const alphaM = sa_m / S;
      const betaM = sb_m / S;
      const laM = alphaM;
      const lbM = betaM;
      const ldM = betaM;
      const leM = -alphaM;
      const cDirect = ex - a * mx - b * my;
      const fDirect = ey - d * mx - e * my;
      const cMirror = ex - laM * mx - lbM * my;
      const fMirror = ey - ldM * mx - leM * my;
      const rmseDirect = rmseOf(a, b, cDirect, d, e, fDirect, pairs);
      const rmseMirror = rmseOf(laM, lbM, cMirror, ldM, leM, fMirror, pairs);
      if (rmseMirror < MIRROR_RMSE_RATIO * rmseDirect) return refuse("reflection");
    }
  } else {
    if (!affine) return refuse("collinear");
    ({ a, b, d, e } = affine);
  }

  // 6. Determinant (reachable for affine only; a similarity's det is alpha²+beta² ≥ 0).
  const det = a * e - b * d;
  if (det < 0) return refuse("reflection");

  // 7. Scale: the mean axis length. `!(scale >= 1e-12)` also catches NaN.
  const scale = (Math.hypot(a, d) + Math.hypot(b, e)) / 2;
  if (!(scale >= 1e-12)) return refuse("degenerate");

  // 8. Translation.
  const transform: Affine = [
    a,
    b,
    ex - a * mx - b * my,
    d,
    e,
    ey - d * mx - e * my,
  ];

  // 9. Residuals: exactly zero with the model's minimum number of pairs.
  let residuals_m: number[];
  let rmse_m: number;
  if (n === MIN_PAIRS[model]) {
    residuals_m = pairs.map(() => 0);
    rmse_m = 0;
  } else {
    residuals_m = pairs.map((p) => {
      const q = applyAffine(transform, p.src);
      return Math.hypot(q[0] - p.dst[0], q[1] - p.dst[1]) * dstUnitM;
    });
    rmse_m = Math.sqrt(residuals_m.reduce((s, r) => s + r * r, 0) / n);
  }

  // 10. Reported scale and rotation; any non-finite result is degenerate.
  const scaleM = scale * dstUnitM;
  const rotation_deg = (Math.atan2(d, a) * 180) / Math.PI;
  if (
    ![...transform, rmse_m, scaleM, rotation_deg, ...residuals_m].every(
      Number.isFinite,
    )
  )
    return refuse("degenerate");

  // 11. Warnings, in this order.
  const warnings: FitWarning[] = [];
  if (rmse_m > 0.25) warnings.push("rmse_high");
  if (unitsScale !== null && Math.abs(scaleM / unitsScale - 1) > 0.02)
    warnings.push("scale_mismatch");
  if (model === "affine") {
    const s = a * a + b * b + d * d + e * e;
    const q = Math.sqrt(Math.max(s * s - 4 * det * det, 0));
    const s1 = Math.sqrt((s + q) / 2);
    const s2 = Math.sqrt(Math.max((s - q) / 2, 0));
    const angle =
      (Math.acos(
        Math.min(
          1,
          Math.abs(a * b + d * e) / (Math.hypot(a, d) * Math.hypot(b, e)),
        ),
      ) *
        180) /
      Math.PI;
    if (s2 === 0 || s1 / s2 - 1 > 0.02 || Math.abs(90 - angle) > 1)
      warnings.push("shear");
  }
  return {
    ok: true,
    transform,
    scale: scaleM,
    rotation_deg,
    rmse_m,
    residuals_m,
    warnings,
  };
}
