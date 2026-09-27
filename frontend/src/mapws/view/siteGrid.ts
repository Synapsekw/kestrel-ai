/**
 * The site tile grid (spec 2026-09-26-map-workspace §6), mirrored from backend/app/workspace/grid.py
 * (M-B1). It is fixed and independent of content: origin (0, 0) in site CRS units,
 * res(z) = 1024 / 2^z metres per pixel for z = 0…20, 256 px tiles, column x = floor(E / (256·res)) and
 * row y = floor(−N / (256·res)), both possibly negative. OpenLayers' TileGrid with origin [0, 0] uses
 * the same y-down row convention, so `siteTileGrid` (siteFrame.ts) needs no y flip.
 * Both sides are pinned on contract/fixtures/site-grid-vectors.json.
 */
export const SITE_TILE = 256;
export const SITE_MAX_Z = 20;
export const SITE_RES0 = 1024;

/** [minE, minN, maxE, maxN] in site CRS units. */
export type SiteExtent = [number, number, number, number];

export interface SiteTile {
  z: number;
  x: number;
  y: number;
}

/** `+ 0` turns −0 into 0, as Python's `math.floor(-0.0)` is the int 0. */
const plain = (v: number): number => v + 0;

export function siteRes(z: number): number {
  if (!Number.isInteger(z) || z < 0 || z > SITE_MAX_Z) {
    throw new RangeError(`zoom ${z} is outside 0…${SITE_MAX_Z}`);
  }
  return SITE_RES0 / 2 ** z;
}

export function siteResolutions(): number[] {
  return Array.from({ length: SITE_MAX_Z + 1 }, (_, z) => siteRes(z));
}

const span = (z: number): number => SITE_TILE * siteRes(z);

export function tileAt(e: number, n: number, z: number): SiteTile {
  const s = span(z);
  return { z, x: plain(Math.floor(e / s)), y: plain(Math.floor(-n / s)) };
}

export function tileBounds(t: SiteTile): SiteExtent {
  const s = span(t.z);
  return [plain(t.x * s), plain(-(t.y + 1) * s), plain((t.x + 1) * s), plain(-t.y * s)];
}

/** A layer's max_zoom: the smallest z with res(z) ≤ native / 2 (capped at 20); the client overzooms past it. */
export function maxZoomFor(nativeRes: number): number {
  if (!Number.isFinite(nativeRes) || nativeRes <= 0) {
    throw new RangeError(`native resolution ${nativeRes} must be a positive number`);
  }
  for (let z = 0; z <= SITE_MAX_Z; z++) if (siteRes(z) <= nativeRes / 2) return z;
  return SITE_MAX_Z;
}
