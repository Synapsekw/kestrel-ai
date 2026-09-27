import type { SegmentCrop } from "../api";

export const MIN_CROP = 512;
export const QUANTUM = 64;

function grow(a: number, b: number, min: number, limit: number): [number, number] {
  const need = Math.min(min, limit) - (b - a);
  if (need <= 0) return [a, b];
  let lo = a - need / 2;
  let hi = b + need / 2;
  if (lo < 0) {
    hi -= lo;
    lo = 0;
  }
  if (hi > limit) {
    lo -= hi - limit;
    hi = limit;
  }
  return [Math.max(0, lo), hi];
}

function snap(a: number, b: number, limit: number): [number, number] {
  const lo = Math.max(0, Math.floor(a / QUANTUM) * QUANTUM);
  const hi = Math.min(limit, Math.ceil(b / QUANTUM) * QUANTUM);
  return [lo, hi];
}

/**
 * I-D6 / §10: the visible viewport in stored-image px, at least 512 px a side, clipped to the image,
 * snapped outward to 64 px (the server repeats the rule and answers the crop it used).
 */
export function viewportCrop(
  view: { scale: number; x: number; y: number },
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): SegmentCrop | null {
  if (viewport.width <= 0 || viewport.height <= 0 || view.scale <= 0) return null;
  let x0 = Math.max(0, -view.x / view.scale);
  let y0 = Math.max(0, -view.y / view.scale);
  let x1 = Math.min(image.width, (viewport.width - view.x) / view.scale);
  let y1 = Math.min(image.height, (viewport.height - view.y) / view.scale);
  if (x1 <= x0 || y1 <= y0) return null;
  [x0, x1] = grow(x0, x1, MIN_CROP, image.width);
  [y0, y1] = grow(y0, y1, MIN_CROP, image.height);
  [x0, x1] = snap(x0, x1, image.width);
  [y0, y1] = snap(y0, y1, image.height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const cropKey = (c: SegmentCrop) => `${c.x},${c.y},${c.w},${c.h}`;

export function inside(c: SegmentCrop, p: { x: number; y: number }): boolean {
  return p.x >= c.x && p.y >= c.y && p.x <= c.x + c.w && p.y <= c.y + c.h;
}
