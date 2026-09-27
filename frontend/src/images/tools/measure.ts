import type { Box } from "@contract/client";
import { distance, toPoints, type Point } from "@/images/canvas/geometry";

/** A trustworthy distance and GSD for this image (spec §9.3, I-D4); null means px only. */
export interface CameraScale {
  gsdMm: number;
  distanceM: number;
  sigmaM: number;
  source: string;
}

/** Structurally `ImageCamera` (C0); kept loose so tests and the lab can pass partial cameras. */
export interface CameraLike {
  gsd_mm?: number | null;
  distance_m?: number | null;
  distance_sigma_m?: number | null;
  distance_source?: string | null;
}

export function scaleFromCamera(camera: CameraLike | null | undefined): CameraScale | null {
  if (!camera) return null;
  const gsd = camera.gsd_mm ?? null;
  const d = camera.distance_m ?? null;
  if (camera.distance_source === "none" || gsd === null || d === null || !(gsd > 0) || !(d > 0)) return null;
  return {
    gsdMm: gsd,
    distanceM: d,
    sigmaM: camera.distance_sigma_m ?? 0,
    source: camera.distance_source ?? "manual",
  };
}

export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain; collinear points dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Max Feret = the hull's diameter; min Feret = the smallest, over hull edges, of the farthest hull
 * point from that edge's line (the calipers' minimum width). O(h²) on the hull, which is at most
 * the polygon's 2,000 vertices and runs only for the selected shape.
 */
export function feret(points: readonly Point[]): { max: number; min: number } {
  const hull = convexHull(points);
  if (hull.length < 2) return { max: 0, min: 0 };
  let max = 0;
  for (let i = 0; i < hull.length; i++)
    for (let j = i + 1; j < hull.length; j++) max = Math.max(max, distance(hull[i], hull[j]));
  if (hull.length < 3) return { max, min: 0 };
  let min = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = distance(a, b);
    if (len === 0) continue;
    let far = 0;
    for (const p of hull) far = Math.max(far, Math.abs(cross(a, b, p)) / len);
    min = Math.min(min, far);
  }
  return { max, min };
}

export function sigmaLengthMm(lengthMm: number, s: CameraScale): number {
  return (lengthMm * s.sigmaM) / s.distanceM + Math.SQRT2 * s.gsdMm;
}

export function sigmaAreaM2(areaM2: number, s: CameraScale): number {
  return (2 * areaM2 * s.sigmaM) / s.distanceM;
}

export function formatLength(mm: number): string {
  return mm < 1000 ? `${Math.round(mm)} mm` : `${(mm / 1000).toFixed(2)} m`;
}

export function formatArea(m2: number): string {
  return `${m2 < 0.01 ? m2.toPrecision(2) : m2.toFixed(2)} m²`;
}

/** The canvas label of a length: "1.00 m ± 28 mm", or "231 px" with no trustworthy distance. */
export function lengthLabel(px: number, s: CameraScale | null): string {
  if (!s) return `${Math.round(px)} px`;
  const mm = px * s.gsdMm;
  return `${formatLength(mm)} ± ${formatLength(sigmaLengthMm(mm, s))}`;
}

export interface MeasuredValue {
  label: string;
  value: string;
  sigma: string | null;
}

export interface MeasuredTiles {
  primary: MeasuredValue | null;
  secondary: MeasuredValue[];
  /** "from GSD 1.8 mm/px · ±4 mm at 38.4 m", or null without a scale. */
  basis: string | null;
  pointMarker: boolean;
}

function lengthValue(label: string, px: number, s: CameraScale | null): MeasuredValue {
  if (!s) return { label, value: `${Math.round(px)} px`, sigma: null };
  const mm = px * s.gsdMm;
  return { label, value: formatLength(mm), sigma: `± ${formatLength(sigmaLengthMm(mm, s))}` };
}

function areaValue(px2: number, s: CameraScale | null): MeasuredValue {
  if (!s) return { label: "Area", value: `${Math.round(px2)} px²`, sigma: null };
  const m2 = (px2 * s.gsdMm * s.gsdMm) / 1e6;
  return { label: "Area", value: formatArea(m2), sigma: `± ${formatArea(sigmaAreaM2(m2, s))}` };
}

/** Spec §9.3's table, for FW's MeasuredSize. */
export function measureShape(
  shape: Pick<Box, "shape" | "w" | "h" | "points">,
  s: CameraScale | null,
): MeasuredTiles {
  if (shape.shape === "point") return { primary: null, secondary: [], basis: null, pointMarker: true };
  let areaPx: number;
  let longPx: number;
  let secondary: MeasuredValue[];
  if (shape.shape === "polygon") {
    const pts = toPoints(shape.points ?? []);
    const f = feret(pts);
    areaPx = polygonArea(pts);
    longPx = f.max;
    secondary = [lengthValue("Max length", f.max, s), lengthValue("Min width", f.min, s)];
  } else {
    longPx = Math.max(shape.w, shape.h);
    areaPx = shape.w * shape.h;
    secondary = [lengthValue("Length", longPx, s), lengthValue("Width", Math.min(shape.w, shape.h), s)];
  }
  const basis = s
    ? `from GSD ${s.gsdMm.toFixed(1)} mm/px · ±${Math.round(sigmaLengthMm(longPx * s.gsdMm, s))} mm at ${s.distanceM.toFixed(1)} m`
    : null;
  return { primary: areaValue(areaPx, s), secondary, basis, pointMarker: false };
}
