import { Matrix4, PerspectiveCamera } from "three";
import type { FrameCamera, Vec3 } from "@/clouds/viewer/types";

/** Test helper (not a test file): a native-CRS origin at the chimney's UTM magnitudes. */
export const O: Vec3 = [243500, 3178000, 40];
export const at = (dx: number, dy: number, dz: number): Vec3 => [O[0] + dx, O[1] + dy, O[2] + dz];

/** A z-up perspective camera as V1's `emitFrame` reports it: absolute `viewProj`, canvas rect in client px. */
export function frameCamera(
  position: Vec3,
  target: Vec3 = O,
  rect: { left: number; top: number; width: number; height: number } = {
    left: 10,
    top: 20,
    width: 800,
    height: 500,
  },
): FrameCamera {
  const cam = new PerspectiveCamera(60, rect.width / rect.height, 0.1, 5000);
  cam.up.set(0, 0, 1);
  cam.position.set(position[0], position[1], position[2]);
  cam.lookAt(target[0], target[1], target[2]);
  cam.updateMatrixWorld(true);
  const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const d = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  const domRect = {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect;
  return {
    viewProj: Float64Array.from(vp.elements),
    rect: domRect,
    position,
    direction: [d[0] / n, d[1] / n, d[2] / n],
  };
}
