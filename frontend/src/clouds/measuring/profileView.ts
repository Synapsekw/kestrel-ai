import { formatPoints } from "@/clouds/format";
import type { MPoint } from "../measure";

/** A cross-section: s (metres along A→B) against z, colours flat r,g,b (spec §8.3, `CloudProfile`). */
export interface ProfileData {
  s: ArrayLike<number>;
  z: ArrayLike<number>;
  rgb: ArrayLike<number> | null;
  count: number;
}
export interface Extent {
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}
/** Canvas pixels from data: x = ox + s·sx, y = oz − z·sz. */
export interface View2D {
  sx: number;
  sz: number;
  ox: number;
  oz: number;
}
export interface SZ {
  s: number;
  z: number;
}

export const PAD_PX = 16;
export const SNAP_PX = 8;

/** The empty-slab copy, verbatim across the preview and the stored profile (Review Focus 5). */
export const EMPTY_SLAB = "No points in this slab; widen the thickness";

export function extentOf(d: ProfileData): Extent | null {
  if (d.count === 0) return null;
  let s0 = Infinity;
  let s1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < d.count; i++) {
    const s = d.s[i];
    const z = d.z[i];
    if (s < s0) s0 = s;
    if (s > s1) s1 = s;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { s0, s1, z0, z1 };
}

export function fitView(e: Extent, w: number, h: number, aspectTrue: boolean): View2D {
  const ds = Math.max(e.s1 - e.s0, 1e-6);
  const dz = Math.max(e.z1 - e.z0, 1e-6);
  const aw = Math.max(w - 2 * PAD_PX, 1);
  const ah = Math.max(h - 2 * PAD_PX, 1);
  let sx = aw / ds;
  let sz = ah / dz;
  if (aspectTrue) sx = sz = Math.min(sx, sz);
  return {
    sx,
    sz,
    ox: PAD_PX + (aw - ds * sx) / 2 - e.s0 * sx,
    oz: h - PAD_PX - (ah - dz * sz) / 2 + e.z0 * sz,
  };
}

export const toPx = (v: View2D, p: SZ) => ({ x: v.ox + p.s * v.sx, y: v.oz - p.z * v.sz });
export const toData = (v: View2D, x: number, y: number): SZ => ({
  s: (x - v.ox) / v.sx,
  z: (v.oz - y) / v.sz,
});

/** Zoom by `factor` keeping the data point under (x, y) where it is. */
export function zoomAt(v: View2D, x: number, y: number, factor: number): View2D {
  return { sx: v.sx * factor, sz: v.sz * factor, ox: x - (x - v.ox) * factor, oz: y - (y - v.oz) * factor };
}

export function panBy(v: View2D, dx: number, dy: number): View2D {
  return { ...v, ox: v.ox + dx, oz: v.oz + dy };
}

/** A 1-2-5 grid step in metres whose lines are at least `minPx` apart. */
export function gridStep(pxPerMetre: number, minPx = 40): number {
  const raw = minPx / pxPerMetre;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Writes each point as a 2 × 2 dot into an RGBA buffer (O(n), no canvas call per point). */
export function rasterise(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  v: View2D,
  d: ProfileData,
  fallback: readonly [number, number, number],
): number {
  buf.fill(0);
  const offsets = [0, 4, 4 * w, 4 * w + 4];
  let drawn = 0;
  for (let i = 0; i < d.count; i++) {
    const x = Math.round(v.ox + d.s[i] * v.sx);
    const y = Math.round(v.oz - d.z[i] * v.sz);
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) continue;
    const r = d.rgb ? d.rgb[3 * i] : fallback[0];
    const g = d.rgb ? d.rgb[3 * i + 1] : fallback[1];
    const b = d.rgb ? d.rgb[3 * i + 2] : fallback[2];
    const k = 4 * (y * w + x);
    for (const o of offsets) {
      buf[k + o] = r;
      buf[k + o + 1] = g;
      buf[k + o + 2] = b;
      buf[k + o + 3] = 255;
    }
    drawn++;
  }
  return drawn;
}

export function nearestPoint(d: ProfileData, v: View2D, x: number, y: number, maxPx = SNAP_PX): SZ | null {
  let best = -1;
  let bestD = maxPx * maxPx;
  for (let i = 0; i < d.count; i++) {
    const dx = v.ox + d.s[i] * v.sx - x;
    const dy = v.oz - d.z[i] * v.sz - y;
    const dd = dx * dx + dy * dy;
    if (dd <= bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best < 0 ? null : { s: d.s[best], z: d.z[best] };
}

export function between(a: SZ, b: SZ): { d: number; ds: number; dz: number } {
  const ds = b.s - a.s;
  const dz = b.z - a.z;
  return { d: Math.hypot(ds, dz), ds: Math.abs(ds), dz };
}

/** A profile point as a 3D point on the section line (t = 0); it may lie anywhere across the slab. */
export function toWorld(line: { a: MPoint; b: MPoint }, p: SZ, thicknessM: number): MPoint {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: line.a.x + (dx / length) * p.s,
    y: line.a.y + (dy / length) * p.s,
    z: p.z,
    uncertainty_m: thicknessM / 2,
  };
}

/** The panel's caption (M1 Ruling R6): an empty slab always says so; otherwise the source. */
export function profileCaption(source: "preview" | "full", data: ProfileData | null): string {
  if (data && data.count === 0) return EMPTY_SLAB;
  if (source === "full" && data) return `Full resolution · ${formatPoints(data.count)}`;
  return "Preview · display points";
}
