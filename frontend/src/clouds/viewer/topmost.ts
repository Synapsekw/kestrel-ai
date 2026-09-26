import type { Vec3 } from "./camera";

/** One point drawn in potree's pick window: which point of which rendered node, and its pixel
 * nearest the window centre (squared pixel distance, potree's own measure). */
export interface WindowHit {
  pIndex: number;
  pcIndex: number;
  d2: number;
}

/**
 * Every point drawn in a `size` x `size` pick window, once each. potree-core 2.0.15's pick material
 * writes the point index into RGB and the rendered node's index + 1 into alpha (0 = nothing drawn);
 * its `findHit` then keeps only the lit pixel nearest the window centre, even one whose alpha names
 * no rendered node (seen on the chimney: alpha 255 with 47 nodes rendered), and the pick answers
 * null. Read before `findHit` zeroes the alpha; the caller drops hits with no node.
 */
export function windowHits(rgba: Uint8Array, size: number): WindowHit[] {
  const byKey = new Map<number, WindowHit>();
  const c = (size - 1) / 2;
  for (let k = 0; 4 * k + 3 < rgba.length; k += 1) {
    const a = rgba[4 * k + 3];
    if (a === 0) continue;
    const pIndex = rgba[4 * k] | (rgba[4 * k + 1] << 8) | (rgba[4 * k + 2] << 16);
    const d2 = ((k % size) - c) ** 2 + (Math.floor(k / size) - c) ** 2;
    const key = (a - 1) * 0x1000000 + pIndex;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { pIndex, pcIndex: a - 1, d2 });
    else if (d2 < seen.d2) seen.d2 = d2;
  }
  return [...byKey.values()];
}

/** The hit drawn nearest the window centre (potree's `findHit` rule, over valid hits only), or null. */
export function nearestToCentre<T extends { d2: number }>(hits: readonly T[]): T | null {
  let best: T | null = null;
  for (const h of hits) if (!best || h.d2 < best.d2) best = h;
  return best;
}

/** How far below the highest hit a point still counts as the top surface (roughness, a gentle slope). */
export const TOP_SURFACE_M = 0.5;

/** The search rings, as fractions of the radius: 0.25, 0.5, 1 and 2 m for the jump's 2 m. */
export const SURFACE_RINGS = [1 / 8, 1 / 4, 1 / 2, 1];

/** A drawn point; `reach` (m) is how far the surface it stands for may extend: its pick uncertainty. */
export interface SurfaceHit extends Vec3 {
  reach?: number;
}

/**
 * The top surface at (x, y), at its point nearest the spot. A hit is "at the spot" within a ring
 * (`SURFACE_RINGS` × `radius`, horizontally) when it lies inside the ring or its own `reach` covers
 * the spot (a coarsely loaded point stands for surface up to its uncertainty away), never beyond
 * `radius`. In the smallest ring with such hits: those within `TOP_SURFACE_M` of their highest, and
 * of those the nearest. Null when none is within `radius`.
 *
 * Not the nearest: over a thin rim the drawn point nearest the spot is often the ground seen past
 * the rim's loaded points (§17.10, first acceptance: a chimney rim at z 188.8 refined to the flue
 * bottom at −41.6, so the close-up framed the wrong height). Not the highest within the whole
 * radius: on the chimney's open ground that is sky noise at z 159 m 1.9 m away, and on a slope the
 * uphill edge. The reach matters because the arrival picks while looking at p50: 230 m below the
 * rim, the rim is loaded at level 3 (u 0.68 m) and its nearest point may be 0.6 m off the spot.
 */
export function topmostWithin<T extends SurfaceHit>(
  hits: readonly T[],
  x: number,
  y: number,
  radius: number,
): T | null {
  const d = hits.map((h) => Math.hypot(h.x - x, h.y - y));
  for (const f of SURFACE_RINGS) {
    const r = radius * f;
    const near = hits.map((h, i) => d[i] <= radius && d[i] <= Math.max(r, h.reach ?? 0));
    let top = -Infinity;
    hits.forEach((h, i) => {
      if (near[i] && h.z > top) top = h.z;
    });
    if (top === -Infinity) continue;
    let best: T | null = null;
    let bestD = Infinity;
    hits.forEach((h, i) => {
      if (near[i] && h.z >= top - TOP_SURFACE_M && d[i] < bestD) {
        best = h;
        bestD = d[i];
      }
    });
    return best;
  }
  return null;
}
