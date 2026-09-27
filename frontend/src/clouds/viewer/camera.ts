import type { ViewName } from "./types";

export type Bounds6 = [number, number, number, number, number, number];
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function siteDiagonal(b: Bounds6): number {
  return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
}

/** Set every frame from the distance to the orbit target (spec §8 "Navigation"). */
export function nearFar(distance: number, diagonal: number): { near: number; far: number } {
  return { near: Math.max(0.05, distance / 2000), far: Math.max(20 * diagonal, 4 * distance) };
}

export function southOblique(target: Vec3, distance: number, elevationDeg = 45): Vec3 {
  const e = (elevationDeg * Math.PI) / 180;
  return { x: target.x, y: target.y - distance * Math.cos(e), z: target.z + distance * Math.sin(e) };
}

function centre(b: Bounds6): Vec3 {
  return { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 };
}

/** From the south, above the site, as in the spike. */
export function wholeSiteView(b: Bounds6): View {
  const target = centre(b);
  return { target, position: southOblique(target, 1.1 * siteDiagonal(b), 40) };
}

export function topView(b: Bounds6): View {
  const target = centre(b);
  const h = 1.6 * Math.max(b[3] - b[0], b[4] - b[1]);
  // a hair south of straight down: an orbit with Z up has no heading when looking exactly along -Z
  return { target, position: { x: target.x, y: target.y - h * 1e-4, z: target.z + h } };
}

export function jumpDistance(footprintDiagonal: number): number {
  return Math.max(40, 3 * footprintDiagonal);
}

export interface View {
  target: Vec3;
  position: Vec3;
}

export const ISO_ELEVATION_DEG = 35;

/** The named views stand 1.1 site diagonals off, as `wholeSiteView` (spec §7 Views). */
function viewDistance(b: Bounds6): number {
  return 1.1 * siteDiagonal(b);
}

/** From the south, looking north, level (plan Ruling 6). */
export function frontView(b: Bounds6): View {
  const target = centre(b);
  return { target, position: { x: target.x, y: target.y - viewDistance(b), z: target.z } };
}

/** From the east, looking west, level. */
export function sideView(b: Bounds6): View {
  const target = centre(b);
  return { target, position: { x: target.x + viewDistance(b), y: target.y, z: target.z } };
}

/** From the south-east at 35 degrees. */
export function isoView(b: Bounds6): View {
  const target = centre(b);
  const d = viewDistance(b);
  const e = (ISO_ELEVATION_DEG * Math.PI) / 180;
  const h = d * Math.cos(e);
  return {
    target,
    position: {
      x: target.x + h * Math.SQRT1_2,
      y: target.y - h * Math.SQRT1_2,
      z: target.z + d * Math.sin(e),
    },
  };
}

export function namedView(name: ViewName, b: Bounds6): View {
  switch (name) {
    case "fit":
      return wholeSiteView(b);
    case "top":
      return topView(b);
    case "front":
      return frontView(b);
    case "side":
      return sideView(b);
    case "iso":
      return isoView(b);
  }
}

export interface PoseView extends View {
  up: Vec3;
  fovDeg: number;
}

const finite3 = (a: readonly number[]) => a.length === 3 && a.every(Number.isFinite);
const obj = (a: readonly number[]): Vec3 => ({ x: a[0], y: a[1], z: a[2] });

/** A stored pose (C-C0's `CloudViewPose`) as a placement, or null when it cannot be one. */
export function poseView(p: {
  position: readonly number[];
  target: readonly number[];
  up: readonly number[];
  fov_deg: number;
}): PoseView | null {
  if (!finite3(p.position) || !finite3(p.target) || !finite3(p.up)) return null;
  if (!(p.fov_deg > 0 && p.fov_deg < 180)) return null;
  if (p.position.every((v, i) => v === p.target[i])) return null;
  return { position: obj(p.position), target: obj(p.target), up: obj(p.up), fovDeg: p.fov_deg };
}

export interface TopOrtho {
  halfWidth: number;
  halfHeight: number;
  /** Render-target size in pixels. */
  width: number;
  height: number;
  position: Vec3;
  target: Vec3;
  near: number;
  far: number;
}

/** The straight-down orthographic camera of the minimap snapshot (spec §7 Snapshot, pickDown's setup). */
export function topOrtho(b: Bounds6, px = 512, marginM = 10): TopOrtho {
  const side = Math.round(Math.min(2048, Math.max(16, px)));
  const w = b[3] - b[0];
  const h = b[4] - b[1];
  const long = Math.max(w, h, 1e-6);
  const c = centre(b);
  const top = b[5] + marginM;
  return {
    halfWidth: Math.max(w, 1e-6) / 2,
    halfHeight: Math.max(h, 1e-6) / 2,
    width: Math.max(1, Math.round((side * w) / long)),
    height: Math.max(1, Math.round((side * h) / long)),
    position: { x: c.x, y: c.y, z: top },
    target: { x: c.x, y: c.y, z: b[2] },
    near: 0.1,
    far: top - b[2] + marginM,
  };
}

/** One step of `scriptOrbit`: the camera turned `radians` about the vertical through the target. */
export function orbitStep(position: Vec3, target: Vec3, radians: number): Vec3 {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: target.x + dx * c - dy * s, y: target.y + dx * s + dy * c, z: position.z };
}
