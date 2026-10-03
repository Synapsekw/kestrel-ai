// Camera glyphs (spec §9 setCameras): one instanced wire pyramid per posed photo, picked within
// 13 px of its projected position (kit engine.js pickCamera).
import * as THREE from "three";
import type { components } from "@contract/client";
import type { Vec3 } from "./pins";

type ImagePose = components["schemas"]["ImagePose"];

export interface CameraPose {
  imageId: string;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  hfovDeg: number;
  vfovDeg: number;
  sequence: string | null;
  outcome: string | null;
}

export const CAMERA_PICK_PX = 13;

const v3 = (a: readonly number[]): Vec3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

export function cameraPosesFrom(rows: readonly ImagePose[]): CameraPose[] {
  return rows.map((r) => ({
    imageId: r.image_id,
    position: v3(r.position),
    target: v3(r.target),
    up: v3(r.up),
    hfovDeg: r.hfov_deg,
    vfovDeg: r.vfov_deg,
    sequence: r.sequence ?? null,
    outcome: r.outcome ?? null,
  }));
}

/** The apex, then the four far corners at distance d. */
export function frustumCorners(hfovDeg: number, vfovDeg: number, d: number): Vec3[] {
  const w = d * Math.tan((hfovDeg * Math.PI) / 360);
  const h = d * Math.tan((vfovDeg * Math.PI) / 360);
  return [
    [0, 0, 0],
    [-w, -h, -d],
    [w, -h, -d],
    [w, h, -d],
    [-w, h, -d],
  ];
}

/** A unit camera pyramid: apex at the origin, a 1.24 x 0.84 base at z = -1 (the kit's marker proportions). */
export function pyramidGeometry(): THREE.BufferGeometry {
  const c = [
    [0, 0, 0],
    [-0.62, -0.42, -1],
    [0.62, -0.42, -1],
    [0.62, 0.42, -1],
    [-0.62, 0.42, -1],
  ];
  const tris = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
    [1, 3, 2],
    [1, 4, 3],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      tris.flat().flatMap((i) => c[i]),
      3,
    ),
  );
  return g;
}

/** Points are in normalised device coordinates (Vector3.project); px, py in the element's pixels. */
export function nearestOnScreen(
  points: readonly { id: string; x: number; y: number; z: number }[],
  px: number,
  py: number,
  viewport: { width: number; height: number },
  radiusPx = CAMERA_PICK_PX,
): string | null {
  let best: string | null = null;
  let bestD = radiusPx * radiusPx;
  for (const p of points) {
    if (p.z < -1 || p.z > 1) continue;
    const sx = ((p.x + 1) / 2) * viewport.width;
    const sy = ((1 - p.y) / 2) * viewport.height;
    const d = (sx - px) ** 2 + (sy - py) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
