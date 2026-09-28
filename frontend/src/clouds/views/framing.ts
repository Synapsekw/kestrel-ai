import type { CloudViewPose } from "@contract/client";
import type { Vec3 } from "../viewer/types";

export const AUTO_FOV_DEG = 50;
export const MIN_DIST_M = 6;
export const MAX_DIST_M = 60;
export const SPHERE_MARGIN = 1.4;
export const MIN_RADIUS_M = 0.5;

const v = (a: readonly number[]): Vec3 => [a[0], a[1], a[2]];
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Unit view direction; north and 45° down when the camera sits on its target. */
function viewDir(cam: CloudViewPose): Vec3 {
  const d = sub(cam.target, cam.position);
  const l = len(d);
  return l > 1e-9 ? scale(d, 1 / l) : [0, Math.SQRT1_2, -Math.SQRT1_2];
}

/** Z up, unless the camera looks (almost) straight up or down: then grid north is up. */
function upFor(dir: Vec3): Vec3 {
  return Math.abs(dir[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
}

export function copyPose(p: CloudViewPose): CloudViewPose {
  return { position: v(p.position), target: v(p.target), up: v(p.up), fov_deg: p.fov_deg };
}

/** Finding create / move (spec §11.3): the current direction, on the anchor, at clamp(distance, 6, 60). */
export function autoFramePoint(cam: CloudViewPose, anchor: Vec3): CloudViewPose {
  const dir = viewDir(cam);
  const dist = clamp(len(sub(cam.target, cam.position)), MIN_DIST_M, MAX_DIST_M);
  return {
    position: sub(anchor, scale(dir, dist)),
    target: v(anchor),
    up: upFor(dir),
    fov_deg: AUTO_FOV_DEG,
  };
}

export function boundingSphere(points: Vec3[]): { centre: Vec3; radius: number } {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 3; i += 1) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = points.reduce((r, p) => Math.max(r, len(sub(p, centre))), 0);
  return { centre, radius };
}

/** Measurement save (spec §11.3): the current direction, fitting the bounding sphere × 1.4 at fov 50°. */
export function autoFrameSphere(cam: CloudViewPose, points: Vec3[]): CloudViewPose {
  const dir = viewDir(cam);
  const { centre, radius } = boundingSphere(points);
  const r = Math.max(radius, MIN_RADIUS_M) * SPHERE_MARGIN;
  // aspect 1.6 > 1: the vertical fov is the one that limits
  const dist = r / Math.sin(((AUTO_FOV_DEG / 2) * Math.PI) / 180);
  return { position: sub(centre, scale(dir, dist)), target: centre, up: upFor(dir), fov_deg: AUTO_FOV_DEG };
}

/** A stored pose moved onto a new target, keeping the camera's offset from it. */
export function retarget(pose: CloudViewPose, target: Vec3): CloudViewPose {
  return {
    position: add(v(target), sub(pose.position, pose.target)),
    target: v(target),
    up: v(pose.up),
    fov_deg: pose.fov_deg,
  };
}
