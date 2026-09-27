import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { mapPixelToCloud } from "@/clouds/jump";
import type { Bounds6 } from "@/clouds/viewer/camera";

type XY = [number, number];

export interface MiniFrame {
  scale: number;
  ox: number;
  oy: number;
  /** minX, minY, maxX, maxY of the cloud in its native CRS. */
  box: [number, number, number, number];
}

/** The cloud's XY box fitted into a w × h minimap with `pad` px, uniform scale, north up. */
export function miniFrame(b: Bounds6, width: number, height: number, pad: number): MiniFrame {
  const w = b[3] - b[0] || 1;
  const h = b[4] - b[1] || 1;
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
  return { scale, ox: (width - w * scale) / 2, oy: (height - h * scale) / 2, box: [b[0], b[1], b[3], b[4]] };
}

export function toMini(f: MiniFrame, x: number, y: number): XY {
  return [f.ox + (x - f.box[0]) * f.scale, f.oy + (f.box[3] - y) * f.scale];
}

export function fromMini(f: MiniFrame, px: number, py: number): XY {
  return [f.box[0] + (px - f.ox) / f.scale, f.box[3] - (py - f.oy) / f.scale];
}

/** An SVG transform placing a 1 × 1 `<image>` by its top-left, top-right and bottom-left corners. */
export function imageMatrix(p0: XY, p1: XY, p3: XY): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `matrix(${r(p1[0] - p0[0])} ${r(p1[1] - p0[1])} ${r(p3[0] - p0[0])} ${r(p3[1] - p0[1])} ${r(p0[0])} ${r(p0[1])})`;
}

/**
 * A linked map preview's top-left, top-right and bottom-left corners in the cloud's CRS (spec C11:
 * the corner transform, not a warp). Null when either side lacks coordinates.
 */
export function underlayCorners(map: GeoMap, cloud: PointCloud): [XY, XY, XY] | null {
  if (!map.geotransform || !map.proj4 || !cloud.proj4) return null;
  const at = (px: number, py: number): XY => {
    const p = mapPixelToCloud(map, cloud, px, py);
    return [p.x, p.y];
  };
  return [at(0, 0), at(map.width, 0), at(0, map.height)];
}

/**
 * The horizontal field of view of a camera from its column-major view-projection matrix: the angle
 * between the left (row3 + row0) and right (row3 − row0) clip planes (Gribb–Hartmann).
 */
export function horizontalFov(m: ArrayLike<number>): number {
  const row = (i: number) => [m[i], m[4 + i], m[8 + i]];
  const r0 = row(0);
  const r3 = row(3);
  const left = r3.map((v, i) => v + r0[i]);
  const right = r3.map((v, i) => v - r0[i]);
  const dot = left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const cos = dot / (Math.hypot(...left) * Math.hypot(...right) || 1);
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * The minimap camera cone (spec §6: half-angle hfov/2, 70 px long) as SVG polygon points "ax,ay
 * lx,ly rx,ry", or null when the camera looks (nearly) straight down.
 */
export function viewCone(
  position: readonly [number, number] | readonly number[],
  direction: readonly number[],
  hfov: number,
  f: MiniFrame,
  lengthPx = 70,
): string | null {
  const h = Math.hypot(direction[0], direction[1]);
  if (h < 1e-6) return null;
  const [ax, ay] = toMini(f, position[0], position[1]);
  const vx = direction[0] / h;
  const vy = -direction[1] / h; // screen y grows downwards
  const side = (a: number): XY => [
    ax + lengthPx * (vx * Math.cos(a) - vy * Math.sin(a)),
    ay + lengthPx * (vx * Math.sin(a) + vy * Math.cos(a)),
  ];
  const r1 = (v: number) => v.toFixed(1);
  const l = side(-hfov / 2);
  const r = side(hfov / 2);
  return `${r1(ax)},${r1(ay)} ${r1(l[0])},${r1(l[1])} ${r1(r[0])},${r1(r[1])}`;
}
