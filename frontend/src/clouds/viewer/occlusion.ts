import * as THREE from "three";
import type { PointCloudOctree, PointCloudOctreeNode } from "potree-core";
import type { EngineParts } from "./engineParts";
import { pickWindowPixels } from "./pickAll";
import type { Vec3 } from "./types";

/** Pixels (CSS) around a projected pin whose drawn points are decoded (spec §7). */
export const OCCLUSION_RADIUS_PX = 3;
/** potree-core refuses more than 255 nodes in one pick render (node index + 1 in 8 bits of alpha). */
export const MAX_PICK_NODES = 254;

/** One pick window: its centre and origin in device pixels (y up), its side in CSS and device px. */
export interface OcclusionWindow {
  centre: [number, number];
  cssSize: number;
  size: number;
  origin: [number, number];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** One window per canvas half, the half's short side, placed exactly as potree places a window
 * around `pixelPosition` (`floor(clamp(centre − (size − 1)/2, 0, canvas))`). */
export function occlusionWindows(cssW: number, cssH: number, dpr: number): OcclusionWindow[] {
  const l = Math.ceil(cssW * dpr);
  const c = Math.ceil(cssH * dpr);
  const landscape = cssW >= cssH;
  const cssSize = landscape ? Math.min(cssW / 2, cssH) : Math.min(cssW, cssH / 2);
  const size = Math.floor(cssSize * dpr);
  const f = (size - 1) / 2;
  const centres: Array<[number, number]> = landscape
    ? [
        [l / 4, c / 2],
        [(3 * l) / 4, c / 2],
      ]
    : [
        [l / 2, (3 * c) / 4],
        [l / 2, c / 4],
      ];
  return centres.map(([x, y]) => ({
    centre: [x, y],
    cssSize,
    size,
    origin: [Math.floor(clamp(x - f, 0, l)), Math.floor(clamp(y - f, 0, c))],
  }));
}

/** NDC → device pixels (y up), or null behind the camera or off the canvas. */
export function toDevicePixel(
  ndc: { x: number; y: number; z: number },
  l: number,
  c: number,
): [number, number] | null {
  if (!(ndc.z >= -1 && ndc.z <= 1) || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
  return [((ndc.x + 1) / 2) * l, ((ndc.y + 1) / 2) * c];
}

/** The window containing a device pixel, with the pixel's column and row in it; null when none. */
export function windowOf(
  px: [number, number],
  windows: readonly OcclusionWindow[],
): { index: number; col: number; row: number } | null {
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    const col = Math.floor(px[0]) - w.origin[0];
    const row = Math.floor(px[1]) - w.origin[1];
    if (col >= 0 && row >= 0 && col < w.size && row < w.size) return { index: i, col, row };
  }
  return null;
}

/** The distinct drawn points (node index, point index) lit within `radius` pixels of (col, row). */
export function hitsNear(
  rgba: Uint8Array,
  size: number,
  col: number,
  row: number,
  radius: number,
): Array<{ pcIndex: number; pIndex: number }> {
  const out: Array<{ pcIndex: number; pIndex: number }> = [];
  const seen = new Set<number>();
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = col + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const k = 4 * (y * size + x);
      const a = rgba[k + 3];
      if (a === 0) continue;
      const pIndex = rgba[k] | (rgba[k + 1] << 8) | (rgba[k + 2] << 16);
      const key = (a - 1) * 0x1000000 + pIndex;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pcIndex: a - 1, pIndex });
    }
  }
  return out;
}

/**
 * How far off the pin's line of sight a drawn point may lie per metre it is nearer (Task 17). A visible
 * surface through the pin, seen at an angle θ from its normal, has neighbours nearer by about their
 * distance from the line × tan θ; 2 lets surfaces seen up to atan 2 ≈ 63° from their normal never
 * occlude their own pin. With the whole chimney in view the 3 px disk is about 5 m across, so the
 * rim beside a pin, not in front of it, read as occluding it.
 */
export const OCCLUSION_CONE_SLOPE = 2;

/** Occluded when a drawn point is in front of the pin: nearer along the line of sight by more than
 * `tolM` plus `OCCLUSION_CONE_SLOPE` × its distance from that line. */
export function isOccluded(camera: Vec3, pin: Vec3, near: readonly Vec3[], tolM: number): boolean {
  const dx = pin[0] - camera[0];
  const dy = pin[1] - camera[1];
  const dz = pin[2] - camera[2];
  const dPin = Math.hypot(dx, dy, dz);
  if (dPin === 0) return false;
  const [ux, uy, uz] = [dx / dPin, dy / dPin, dz / dPin];
  return near.some((q) => {
    const sx = q[0] - camera[0];
    const sy = q[1] - camera[1];
    const sz = q[2] - camera[2];
    const along = sx * ux + sy * uy + sz * uz;
    const off = Math.hypot(sx - along * ux, sy - along * uy, sz - along * uz);
    return dPin - along - tolM > OCCLUSION_CONE_SLOPE * off;
  });
}

/** The visible nodes nearest the camera first, at most `max` (plan Ruling 11). */
function nearestNodes(pco: PointCloudOctree, camera: THREE.Camera, max: number): PointCloudOctreeNode[] {
  const s = new THREE.Sphere();
  const scored = pco.visibleNodes.map((n) => ({
    n,
    d: s.copy(n.boundingSphere).applyMatrix4(pco.matrixWorld).center.distanceTo(camera.position),
  }));
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, max).map((x) => x.n);
}

/**
 * The settle-time occlusion pass (spec §7, C6): one pick render per canvas half, then only the
 * pixels within 3 px of each projected point are decoded. Null unless the engine is idle with a
 * cloud (plan Ruling 11). `tolM[i]` is point i's tolerance.
 */
export function runOcclusion(
  parts: EngineParts,
  points: readonly Vec3[],
  tolM: readonly number[],
): boolean[] | null {
  const pco = parts.pco();
  if (!pco || !parts.idle() || parts.frozen()) return null;
  const { renderer, camera, canvas } = parts;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = renderer.getPixelRatio();
  const l = Math.ceil(rect.width * dpr);
  const c = Math.ceil(rect.height * dpr);
  const windows = occlusionWindows(rect.width, rect.height, dpr);
  const out = points.map(() => false);
  camera.updateMatrixWorld();
  const placed = points.map((p) => {
    const px = toDevicePixel(new THREE.Vector3(...p).project(camera), l, c);
    return px ? windowOf(px, windows) : null;
  });
  if (!placed.some(Boolean)) return out;
  const nodes = nearestNodes(pco, camera, MAX_PICK_NODES);
  const radius = Math.ceil(OCCLUSION_RADIUS_PX * dpr);
  const cam: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const q = new THREE.Vector3();
  windows.forEach((win, wi) => {
    if (!placed.some((p) => p?.index === wi)) return;
    const caster = new THREE.Raycaster();
    caster.setFromCamera(new THREE.Vector2((win.centre[0] / l) * 2 - 1, (win.centre[1] / c) * 2 - 1), camera);
    const got = parts.pickGuard(() =>
      pickWindowPixels(pco, renderer, camera, caster.ray, {
        windowSize: win.cssSize,
        pixel: new THREE.Vector3(win.centre[0], win.centre[1], 0),
        nodes,
        params: parts.pickParams(),
      }),
    );
    if (!got) return;
    placed.forEach((p, i) => {
      if (!p || p.index !== wi) return;
      const near: Vec3[] = [];
      for (const h of hitsNear(got.rgba, got.size, p.col, p.row, radius)) {
        const scene = got.nodes[h.pcIndex]?.node.sceneNode;
        const pos = scene?.geometry?.attributes.position;
        if (!scene || !pos || h.pIndex >= pos.count) continue;
        q.fromBufferAttribute(pos, h.pIndex).applyMatrix4(scene.matrixWorld);
        near.push([q.x, q.y, q.z]);
      }
      out[i] = isOccluded(cam, points[i], near, tolM[i] ?? 0.3);
    });
  });
  return out;
}
