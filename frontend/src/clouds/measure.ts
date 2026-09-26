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
export const KIND_LABEL: Record<MeasureKind, string> = {
  point: "Point",
  distance: "Distance",
  height: "Height difference",
  vertical: "Vertical check",
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
