/**
 * The map's pixel grid as OpenLayers sees it (spec section 7). Map pixel (px, py) has y down;
 * OpenLayers wants y up, so a map lives at (px, -py), below the origin. At zoom z one tile pixel
 * covers 2^(maxZoom - z) map pixels, exactly as the backend's tile endpoint computes it.
 */
export const TILE = 256;

export type Extent = [number, number, number, number];

export function resolutions(maxZoom: number): number[] {
  return Array.from({ length: maxZoom + 1 }, (_, z) => 2 ** (maxZoom - z));
}

export function olExtent(m: { width: number; height: number }): Extent {
  return [0, -m.height, m.width, 0];
}

export function toOl(px: number, py: number): [number, number] {
  return [px, -py];
}

export function fromOl(c: number[]): [number, number] {
  return [c[0], -c[1]];
}

export function boxRing(x: number, y: number, w: number, h: number): number[][] {
  return [toOl(x, y), toOl(x + w, y), toOl(x + w, y + h), toOl(x, y + h), toOl(x, y)];
}

/** `x0,y0,x1,y1` in map pixels for the detections query; null when the view misses the map. */
export function bboxParam(extent: Extent, m: { width: number; height: number }): string | null {
  const x0 = Math.max(0, Math.floor(extent[0]));
  const x1 = Math.min(m.width, Math.ceil(extent[2]));
  const y0 = Math.max(0, Math.floor(-extent[3]));
  const y1 = Math.min(m.height, Math.ceil(-extent[1]));
  if (x0 >= x1 || y0 >= y1) return null;
  return `${x0},${y0},${x1},${y1}`;
}

const STEPS = [1, 2, 5];

/** The longest round length (1/2/5 x 10^n metres) that fits in `maxPx` screen pixels. */
export function scaleBar(
  resolution: number,
  gsdCm: number | null,
  maxPx = 120,
): { px: number; label: string } | null {
  if (!gsdCm) return null;
  const metresPerScreenPx = (resolution * gsdCm) / 100;
  const maxMetres = maxPx * metresPerScreenPx;
  const exp = Math.floor(Math.log10(maxMetres));
  let metres = 10 ** exp;
  for (const s of STEPS) if (s * 10 ** exp <= maxMetres) metres = s * 10 ** exp;
  const px = Math.round(metres / metresPerScreenPx);
  const label =
    metres >= 1000 ? `${metres / 1000} km` : metres >= 1 ? `${metres} m` : `${Math.round(metres * 100)} cm`;
  return { px, label };
}
