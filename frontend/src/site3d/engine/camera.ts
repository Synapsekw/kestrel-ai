import * as THREE from "three";

/** "fit" (iso over everything), "plan" (top-down, plant north up), or an area preset from the model. */
export type PresetId = "fit" | "plan" | `area:${string}`;
export interface CamView {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** From the target towards the camera: south-west of the site and above (north is +X, east +Z). */
export const ISO_DIR = new THREE.Vector3(-1, 0.9, -1).normalize();
export const PLAN_TILT = 0.002;

/** Straight down, tilted a hair so the camera's up (+Y) projects to plant north (+X) on screen. */
export function planDir(): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(PLAN_TILT), Math.cos(PLAN_TILT), 0);
}

/** Where to stand, along `dir` from the box centre, to see the whole box. */
export function viewBox(box: THREE.Box3, dir: THREE.Vector3, fovDeg: number, aspect: number): CamView {
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-3));
  const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
  return { position: target.clone().addScaledVector(dir.clone().normalize(), dist), target };
}

export const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
export const FLY_SHIFT_FACTOR = 4;
const UP = new THREE.Vector3(0, 1, 0);

export const FLY_MIN_HEIGHT_M = 10;

/**
 * `clamp(heightAboveDatum, 10, siteDiagonal) / 4` m/s, × 4 with Shift: slow near the ground, fast
 * high above the site (the fly target sits a fixed 10 m ahead, so it cannot scale the speed).
 */
export function flySpeed(heightAboveDatum: number, siteDiagonal: number, shift: boolean): number {
  const top = Math.max(siteDiagonal, FLY_MIN_HEIGHT_M);
  const d = Math.min(Math.max(heightAboveDatum, FLY_MIN_HEIGHT_M), top);
  return (d / 4) * (shift ? FLY_SHIFT_FACTOR : 1);
}

/** W/S along the view, A/D strafe level, E/Q up/down (world Y): the step for `dt` seconds. */
export function flyDelta(
  held: ReadonlySet<string>,
  forward: THREE.Vector3,
  speed: number,
  dt: number,
): THREE.Vector3 {
  const f = forward.clone().normalize();
  const r = new THREE.Vector3().crossVectors(f, UP).normalize();
  const v = new THREE.Vector3();
  if (held.has("KeyW")) v.add(f);
  if (held.has("KeyS")) v.sub(f);
  if (held.has("KeyD")) v.add(r);
  if (held.has("KeyA")) v.sub(r);
  if (held.has("KeyE")) v.add(UP);
  if (held.has("KeyQ")) v.sub(UP);
  if (v.lengthSq() === 0) return v;
  return v.normalize().multiplyScalar(speed * dt);
}
