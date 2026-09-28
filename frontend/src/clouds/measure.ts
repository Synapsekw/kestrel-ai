import type { CloudMeasurementKind, CloudMeasurementParams } from "@contract/client";

import type { PointCloud } from "@/api/clouds";
import type { Vec3 } from "./viewer/camera";
import type { OverlayShape } from "./viewer/overlay";

/** Spec §9.3, identical to backend/app/pointclouds/measure.py; both are pinned by
 * contract/fixtures/cloud-measure-vectors.json to 1e-9. */
export const FIELDS = [
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
] as const;
export type Field = (typeof FIELDS)[number];
export type Results = Record<Field, number | null>;
export type MeasureKind = "point" | "distance" | "height" | "vertical";
export interface MPoint {
  x: number;
  y: number;
  z: number;
  uncertainty_m: number;
}

export const MIN_VERTICAL_SPAN_M = 0.5;
/** A label for every saved kind, including the ones later units build (area C-B1, profile C-B2). */
export const KIND_LABEL: Record<CloudMeasurementKind, string> = {
  point: "Point",
  distance: "Distance",
  height: "Height difference",
  vertical: "Vertical check",
  area: "Area",
  profile: "Cross-section",
};

export const pointsNeeded = (kind: MeasureKind): 1 | 2 => (kind === "point" ? 1 : 2);

export function ordered<T extends { z: number }>(kind: MeasureKind, pts: T[]): T[] {
  return kind === "vertical" && pts.length === 2 && pts[1].z < pts[0].z ? [pts[1], pts[0]] : [...pts];
}

const deg = (r: number) => (r * 180) / Math.PI;

export function results(kind: MeasureKind, pts: MPoint[]): Results {
  const out = Object.fromEntries(FIELDS.map((f) => [f, null])) as Results;
  if (kind === "point") {
    out.uncertainty_m = pts[0].uncertainty_m;
    return out;
  }
  const [a, b] = ordered(kind, pts);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const u = Math.sqrt(a.uncertainty_m ** 2 + b.uncertainty_m ** 2);
  const h = Math.hypot(dx, dy);
  Object.assign(out, {
    dx,
    dy,
    dz,
    distance_3d: Math.sqrt(dx * dx + dy * dy + dz * dz),
    distance_horizontal: h,
    distance_vertical: Math.abs(dz),
    height_difference: dz,
    uncertainty_m: u,
  });
  if (kind === "vertical") {
    const span = Math.abs(dz);
    Object.assign(out, {
      lean_offset_m: h,
      lean_angle_deg: deg(Math.atan2(h, span)),
      lean_azimuth_deg: (deg(Math.atan2(dx, dy)) + 360) % 360,
      lean_mm_per_m: (1000 * h) / span,
      angle_uncertainty_deg: deg(Math.atan(u / span)),
    });
  }
  return out;
}

export function isGeographic(cloud: Pick<PointCloud, "proj4">): boolean {
  return !!cloud.proj4 && /\+proj=(longlat|latlong)\b/.test(cloud.proj4);
}

/** What the server would refuse, said before Save (spec §9.3; Review Focus 4). */
export function refusal(kind: MeasureKind, pts: MPoint[], geographic: boolean): string | null {
  if (kind !== "point" && geographic)
    return "distances need a projected coordinate system; this cloud is in degrees";
  if (kind === "vertical" && pts.length === 2 && Math.abs(pts[1].z - pts[0].z) < MIN_VERTICAL_SPAN_M) {
    return "pick points further apart vertically (at least 0.5 m)";
  }
  return null;
}

/** The results fields C added (contract `CloudMeasurementResults`, C-C0), in contract order. */
export const AREA_FIELDS = [
  "area_m2",
  "area_surface_m2",
  "area_plan_m2",
  "perimeter_m",
  "plane_rms_m",
  "plane_tilt_deg",
  "plane_azimuth_deg",
  "uncertainty_m2",
] as const;
export const RING_FIELDS = [
  "ring_radius_lower_m",
  "ring_radius_upper_m",
  "ring_rms_lower_m",
  "ring_rms_upper_m",
] as const;
export const PROFILE_FIELDS = [
  "profile_length_m",
  "profile_z_min",
  "profile_z_max",
  "profile_width_max_m",
  "profile_point_count",
] as const;
export type AllField =
  Field | (typeof AREA_FIELDS)[number] | (typeof RING_FIELDS)[number] | (typeof PROFILE_FIELDS)[number];
export type AllResults = Record<AllField, number | null>;
export const ALL_FIELDS: readonly AllField[] = [...FIELDS, ...AREA_FIELDS, ...RING_FIELDS, ...PROFILE_FIELDS];

export function nullResults(): AllResults {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f, null])) as AllResults;
}

// ---- area and rings: a line-for-line mirror of backend/app/pointclouds/measure.py (C-B1), 1e-9.

export const MIN_AREA_M2 = 1e-4;
export const MAX_AREA_VERTICES = 200;
export const SAME_POINT_M = 1e-6;
export const RING_MIN_PICKS = 3;
export const RINGS_MAX_PICKS = 64;
export const RING_COND_MAX = 1e8;

/** A geometry the server refuses with 422 `code` (measure.py's `Refusal`); `message` is its copy. */
export class MeasureRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MeasureRefusal";
  }
}

export interface GPoint extends MPoint {
  /** Rings: 0 or 1 (the operator's ring order); absent for every other kind. */
  group?: number | null;
}
export type ComputableKind = Exclude<CloudMeasurementKind, "profile">;

type V = [number, number, number];
type P2 = [number, number];
const xyzOf = (p: MPoint): V => [p.x, p.y, p.z];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V) => Math.sqrt(dot(a, a));
const neg = (a: V): V => [-a[0], -a[1], -a[2]];

export const TOO_LARGE = "these coordinates are too large to measure";

function finite<T extends Record<string, number | null>>(out: T, code: string): T {
  for (const v of Object.values(out))
    if (v !== null && !Number.isFinite(v)) throw new MeasureRefusal(code, TOO_LARGE);
  return out;
}

/** The outline as stored: closed implicitly, so trailing repeats of the first vertex are dropped. */
export function areaVertices<T extends MPoint>(points: readonly T[]): T[] {
  const pts = [...points];
  while (pts.length >= 2 && norm(sub(xyzOf(pts[pts.length - 1]), xyzOf(pts[0]))) <= SAME_POINT_M) pts.pop();
  return pts;
}

const orient = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const within = (a: P2, b: P2, c: P2) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

function segmentsTouch(p1: P2, p2: P2, p3: P2, p4: P2, eps: number): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
    return true;
  return (
    (Math.abs(d1) <= eps && within(p3, p4, p1)) ||
    (Math.abs(d2) <= eps && within(p3, p4, p2)) ||
    (Math.abs(d3) <= eps && within(p1, p2, p3)) ||
    (Math.abs(d4) <= eps && within(p1, p2, p4))
  );
}

/** Two non-adjacent edges touching, or an edge folding back over the previous one (a spike). */
function selfIntersects(q: readonly P2[]): boolean {
  const n = q.length;
  let m = 0;
  for (const [x, y] of q) m = Math.max(m, Math.abs(x), Math.abs(y));
  const scale = Math.max(1, m);
  const eps = 1e-12 * scale * scale;
  for (let i = 0; i < n; i++) {
    const a = q[i];
    const b = q[(i + 1) % n];
    const c = q[(i + 2) % n];
    if (Math.abs(orient(a, b, c)) <= eps && (c[0] - b[0]) * (a[0] - b[0]) + (c[1] - b[1]) * (a[1] - b[1]) > 0)
      return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // edges n-1 and 0 share vertex 0
      if (segmentsTouch(a, b, q[j], q[(j + 1) % n], eps)) return true;
    }
  }
  return false;
}

/** Spec §8.2 area (Newell), translated to its centroid first. Throws `MeasureRefusal`. */
export function areaResults(points: readonly MPoint[], params: CloudMeasurementParams | null): AllResults {
  const pts = areaVertices(points);
  const n = pts.length;
  if (!(n >= 3 && n <= MAX_AREA_VERTICES))
    throw new MeasureRefusal("wrong_point_count", "an area needs 3 to 200 vertices");
  const p = pts.map(xyzOf);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of p) cx += v[0];
  for (const v of p) cy += v[1];
  for (const v of p) cz += v[2];
  const c: V = [cx / n, cy / n, cz / n];
  const q = p.map((v) => sub(v, c));
  for (let i = 0; i < n; i++)
    if (norm(sub(q[(i + 1) % n], q[i])) <= SAME_POINT_M)
      throw new MeasureRefusal("degenerate_polygon", "two consecutive vertices are the same point");
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = q[i];
    const b = q[(i + 1) % n];
    const k = cross(a, b);
    sx += k[0];
    sy += k[1];
    sz += k[2];
    perimeter += norm(sub(b, a));
  }
  const bigN: V = [sx / 2, sy / 2, sz / 2];
  const surface = norm(bigN);
  if (!(Number.isFinite(surface) && Number.isFinite(perimeter)))
    throw new MeasureRefusal("degenerate_polygon", TOO_LARGE);
  if (surface < MIN_AREA_M2)
    throw new MeasureRefusal(
      "degenerate_polygon",
      "the outline has no area (less than 1 cm²); pick vertices around a surface",
    );
  const nhat: V = [bigN[0] / surface, bigN[1] / surface, bigN[2] / surface];
  const helper: V = Math.abs(nhat[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const h1 = cross(helper, nhat);
  const l1 = norm(h1);
  const e1: V = [h1[0] / l1, h1[1] / l1, h1[2] / l1];
  const e2 = cross(nhat, e1);
  if (selfIntersects(q.map((v): P2 => [dot(v, e1), dot(v, e2)])))
    throw new MeasureRefusal(
      "self_intersecting",
      "the outline crosses itself; pick the vertices in order around the area",
    );
  const view = (params?.view_dir ?? null) as V | null;
  let facing = nhat;
  if (view !== null && norm(view) > 0) {
    if (dot(nhat, view) > 0) facing = neg(nhat); // turn the normal towards the camera
  } else if (nhat[2] < 0) facing = neg(nhat); // no camera: upward; a wall (n_z == 0) keeps the winding
  const horizontal = Math.hypot(facing[0], facing[1]);
  const plan = Math.abs(bigN[2]);
  let su = 0;
  for (const v of pts) su += v.uncertainty_m * v.uncertainty_m;
  let sr = 0;
  for (const v of q) {
    const d = dot(v, nhat);
    sr += d * d;
  }
  return {
    ...nullResults(),
    ...finite(
      {
        area_m2: (params?.mode || "surface") === "plan" ? plan : surface,
        area_surface_m2: surface,
        area_plan_m2: plan,
        perimeter_m: perimeter,
        plane_rms_m: Math.sqrt(sr / n),
        plane_tilt_deg: deg(Math.acos(Math.min(1, Math.abs(nhat[2])))),
        plane_azimuth_deg: horizontal < 1e-12 ? null : (deg(Math.atan2(facing[0], facing[1])) + 360) % 360,
        uncertainty_m2: perimeter * Math.sqrt(su / n),
      },
      "degenerate_polygon",
    ),
  };
}

/** The UI note (spec §8.2), never a refusal. */
export const NON_COPLANAR_NOTE = "vertices are not coplanar; the surface area is the largest projected area";
export function isNonCoplanar(r: Pick<AllResults, "plane_rms_m" | "area_surface_m2">): boolean {
  if (r.plane_rms_m === null || r.area_surface_m2 === null) return false;
  return r.plane_rms_m > Math.max(0.05, 0.05 * Math.sqrt(r.area_surface_m2));
}

/** A vertical check's method: `points` (two picks, S1) unless the params say `rings`. */
export function methodOf(params: CloudMeasurementParams | null): "points" | "rings" {
  return params?.method || "points";
}

export interface RingFit {
  x: number;
  y: number;
  /** The mean z of the ring's picks. */
  z: number;
  radius_m: number;
  rms_m: number;
  uncertainty_m: number;
}

/** Kåsa least-squares circle in XY on centred coordinates (measure.py `fit_ring`). */
export function fitRing(points: readonly MPoint[]): RingFit {
  const k = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) mx += p.x;
  mx /= k;
  for (const p of points) my += p.y;
  my /= k;
  const u = points.map((p) => p.x - mx);
  const v = points.map((p) => p.y - my);
  let suu = 0;
  let svv = 0;
  let suv = 0;
  for (const a of u) suu += a * a;
  for (const b of v) svv += b * b;
  for (let i = 0; i < k; i++) suv += u[i] * v[i];
  const trace = suu + svv;
  const det = suu * svv - suv * suv;
  if (![mx, my, suu, svv, suv, trace * trace, det].every(Number.isFinite))
    throw new MeasureRefusal("collinear_ring", TOO_LARGE);
  const disc = Math.sqrt(Math.max((trace * trace) / 4 - det, 0));
  const lmax = trace / 2 + disc;
  const lmin = trace / 2 - disc;
  if (lmin <= 0 || lmax / lmin > RING_COND_MAX)
    throw new MeasureRefusal(
      "collinear_ring",
      "the picks on a ring lie in a line; pick points spread around the ring",
    );
  const w = u.map((a, i) => a * a + v[i] * v[i]);
  let bu = 0;
  let bv = 0;
  let sw = 0;
  for (let i = 0; i < k; i++) bu += u[i] * w[i];
  for (let i = 0; i < k; i++) bv += v[i] * w[i];
  for (const c of w) sw += c;
  const d = -(svv * bu - suv * bv) / det;
  const e = -(suu * bv - suv * bu) / det;
  const f = -sw / k;
  const cx = mx - d / 2;
  const cy = my - e / 2;
  const r = Math.sqrt(Math.max((d * d) / 4 + (e * e) / 4 - f, 0));
  let rr = 0;
  for (const p of points) {
    const t = Math.hypot(p.x - cx, p.y - cy) - r;
    rr += t * t;
  }
  const rms = Math.sqrt(rr / k);
  let mu = 0;
  for (const p of points) mu += p.uncertainty_m * p.uncertainty_m;
  mu /= k;
  let z = 0;
  for (const p of points) z += p.z;
  return { x: cx, y: cy, z: z / k, radius_m: r, rms_m: rms, uncertainty_m: Math.sqrt(rms * rms + mu / k) };
}

/** The two fitted rings, lower first by z, whatever their `group` numbers say (measure.py `ring_axis`). */
export function ringAxis(points: readonly GPoint[]): [RingFit, RingFit] {
  if (points.some((p) => p.group !== 0 && p.group !== 1))
    throw new MeasureRefusal(
      "ring_needs_three_points",
      "every ring pick needs its ring: group 0 (lower) or 1 (upper)",
    );
  const g0 = points.filter((p) => p.group === 0);
  const g1 = points.filter((p) => p.group === 1);
  if (Math.min(g0.length, g1.length) < RING_MIN_PICKS)
    throw new MeasureRefusal(
      "ring_needs_three_points",
      "each ring needs at least three picks (press N to start the upper ring)",
    );
  if (points.length > RINGS_MAX_PICKS)
    throw new MeasureRefusal("wrong_point_count", "a rings vertical check takes 6 to 64 picks");
  const a = fitRing(g0);
  const b = fitRing(g1);
  return b.z < a.z ? [b, a] : [a, b];
}

/** The S1 vertical formulas between the two fitted centres, plus each ring's radius and RMS. */
export function ringsResults(points: readonly GPoint[]): AllResults {
  const [lower, upper] = ringAxis(points);
  if (upper.z - lower.z < MIN_VERTICAL_SPAN_M)
    throw new MeasureRefusal(
      "vertical_span_too_small",
      "pick points further apart vertically (at least 0.5 m)",
    );
  return {
    ...nullResults(),
    ...finite(
      {
        ...results("vertical", [lower, upper]),
        ring_radius_lower_m: lower.radius_m,
        ring_radius_upper_m: upper.radius_m,
        ring_rms_lower_m: lower.rms_m,
        ring_rms_upper_m: upper.rms_m,
      },
      "collinear_ring",
    ),
  };
}

/** Every computable kind as the server computes it; throws `MeasureRefusal` like measure.py. */
export function measureResults(
  kind: ComputableKind,
  points: readonly GPoint[],
  params: CloudMeasurementParams | null,
): AllResults {
  if (kind === "area") return areaResults(points, params);
  if (kind === "vertical" && methodOf(params) === "rings") return ringsResults(points);
  return { ...nullResults(), ...results(kind, [...points]) };
}

/** The server's refusal said before Save (area and rings; S1 kinds keep `refusal`). */
export function measureRefusal(
  kind: ComputableKind,
  points: readonly GPoint[],
  params: CloudMeasurementParams | null,
): MeasureRefusal | null {
  if (kind !== "area" && !(kind === "vertical" && methodOf(params) === "rings")) return null;
  try {
    measureResults(kind, points, params);
    return null;
  } catch (e) {
    if (e instanceof MeasureRefusal) return e;
    throw e;
  }
}

const xyz = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });

/** The 3D overlay: picks, the segment, and for a vertical check the plumb line through the lower
 * pick plus the horizontal offset at the upper pick's height (spec §9.1). */
export function overlayShapes(kind: MeasureKind, picks: MPoint[], hover: MPoint | null): OverlayShape[] {
  const shown = picks.length < pointsNeeded(kind) && hover ? [...picks, hover] : picks;
  if (shown.length === 0) return [];
  const shapes: OverlayShape[] = [{ kind: "points", points: shown.map(xyz), tone: "accent" }];
  if (shown.length < 2) return shapes;
  const [a, b] = kind === "vertical" ? ordered(kind, shown) : shown;
  shapes.push({ kind: "line", points: [xyz(a), xyz(b)], tone: "accent" });
  if (kind === "vertical") {
    const top = { x: a.x, y: a.y, z: b.z };
    shapes.push({ kind: "line", points: [xyz(a), top], tone: "ok" });
    shapes.push({ kind: "line", points: [top, xyz(b)], tone: "warn" });
  }
  return shapes;
}
