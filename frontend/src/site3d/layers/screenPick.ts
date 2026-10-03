import * as THREE from "three";

export const PICK_PX = 12;

/**
 * The index of the point (xyz triples, scene metres) drawn nearest the pointer within `maxPx`, or
 * null. Points behind the camera are skipped. Screen-space, because glyphs and pins are a few
 * pixels across at site scale and a ray would miss them.
 */
export function screenNearest(
  points: Float32Array,
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  maxPx = PICK_PX,
): number | null {
  const v = new THREE.Vector3();
  let best = -1;
  let bestD = maxPx * maxPx;
  for (let i = 0; i * 3 + 2 < points.length; i++) {
    v.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= 0) continue; // behind or at the camera: the camera looks down its own -z
    v.applyMatrix4(camera.projectionMatrix);
    const sx = rect.left + ((v.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - v.y) / 2) * rect.height;
    const d = (sx - clientX) ** 2 + (sy - clientY) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}
