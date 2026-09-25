import type { Vec3 } from "./camera";

/** One lit pixel of potree's pick window: which point of which rendered node drew it. */
export interface WindowHit {
  pIndex: number;
  pcIndex: number;
}

/**
 * Every point drawn in a pick window, once each. potree-core 2.0.15's pick material writes the point
 * index into RGB and the rendered node's index + 1 into alpha (0 = nothing drawn); its `findHit`
 * then keeps only the lit pixel nearest the window centre. Read before `findHit` zeroes the alpha.
 */
export function windowHits(rgba: Uint8Array): WindowHit[] {
  const seen = new Set<number>();
  const out: WindowHit[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    const pIndex = rgba[i] | (rgba[i + 1] << 8) | (rgba[i + 2] << 16);
    const key = (a - 1) * 0x1000000 + pIndex;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pIndex, pcIndex: a - 1 });
  }
  return out;
}

/** How far below the highest hit a point still counts as the top surface (roughness, a gentle slope). */
export const TOP_SURFACE_M = 0.5;

/**
 * The top surface within `radius` m (horizontally) of (x, y), at its point nearest the spot: of the
 * hits within the radius, those within `TOP_SURFACE_M` of the highest, the nearest of them; null when
 * none is within the radius. The top surface is what a map of the site shows there (the ortho keeps
 * the highest point per cell).
 *
 * Not simply the nearest: over a thin rim the drawn point nearest the spot is often the ground seen
 * past the rim's loaded points (§17.10, first acceptance: a chimney rim at z 188.8 refined to the
 * flue bottom at −41.6, so the close-up framed the wrong height). Not simply the highest either: on
 * a gentle slope that is the uphill edge 2 m away. The price: a structure more than 0.5 m taller
 * within the radius sets the height.
 */
export function topmostWithin<T extends Vec3>(
  hits: readonly T[],
  x: number,
  y: number,
  radius: number,
): T | null {
  let top = -Infinity;
  for (const h of hits) if (h.z > top && Math.hypot(h.x - x, h.y - y) <= radius) top = h.z;
  let best: T | null = null;
  let bestD = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d > radius || h.z < top - TOP_SURFACE_M) continue;
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}
