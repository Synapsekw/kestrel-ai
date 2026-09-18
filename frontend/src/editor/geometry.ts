export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  width: number;
  height: number;
}
/** display = image * scale + (x, y); the Konva stage uses exactly these three numbers. */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;
export const ZOOM_STEP = 1.15;
export const FIT_PADDING = 16;
/** Largest `max_side` the editor asks the backend for; prepared images are 4000 px so this is full size. */
export const DISPLAY_MAX_SIDE = 4096;
/** Smallest box side in image pixels; anything smaller is treated as a click. */
export const MIN_BOX_SIDE = 2;
/** A drag shorter than this in display pixels (both axes) is a click, never a box. */
export const MIN_DRAG_PX = 4;

export function toImage(p: Point, v: ViewTransform): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function toDisplay(p: Point, v: ViewTransform): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function fitView(image: Size, viewport: Size, padding = FIT_PADDING): ViewTransform {
  const availW = Math.max(1, viewport.width - 2 * padding);
  const availH = Math.max(1, viewport.height - 2 * padding);
  const scale = clampScale(Math.min(availW / image.width, availH / image.height));
  return {
    scale,
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
  };
}

/** Scale 1 while keeping whatever image point is under the viewport centre in place. */
export function oneToOneView(viewport: Size, current: ViewTransform): ViewTransform {
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const anchor = toImage(centre, current);
  return { scale: 1, x: centre.x - anchor.x, y: centre.y - anchor.y };
}

export function zoomAround(v: ViewTransform, at: Point, factor: number): ViewTransform {
  const scale = clampScale(v.scale * factor);
  const anchor = toImage(at, v);
  return { scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function clampRect(r: Rect, image: Size): Rect {
  const w = Math.min(Math.max(r.w, MIN_BOX_SIDE), image.width);
  const h = Math.min(Math.max(r.h, MIN_BOX_SIDE), image.height);
  const x = Math.min(Math.max(r.x, 0), image.width - w);
  const y = Math.min(Math.max(r.y, 0), image.height - h);
  return { x, y, w, h };
}

export function roundRect(r: Rect, decimals = 1): Rect {
  const f = 10 ** decimals;
  const round = (n: number) => Math.round(n * f) / f;
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
}

export function rectEquals(a: Rect, b: Rect, eps = 0.05): boolean {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  );
}

export function rectOf(b: { x: number; y: number; w: number; h: number }): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

export function isDrawable(r: Rect): boolean {
  return r.w >= MIN_BOX_SIDE && r.h >= MIN_BOX_SIDE;
}

export function displayMaxSide(image: Size, cap = DISPLAY_MAX_SIDE): number {
  return Math.min(cap, Math.max(image.width, image.height));
}

export function duplicateOffset(r: Rect, image: Size, offset = 12): Rect {
  return clampRect({ ...r, x: r.x + offset, y: r.y + offset }, image);
}

/**
 * The box a drag from `start` to `end` (display pixels) draws, or `null` for a click, a few pixels
 * of jitter or a degenerate rectangle. The minimum-size check runs on the raw drag, before
 * clamping, because `clampRect` would otherwise turn a click into a 2 x 2 box.
 */
export function dragRect(start: Point, end: Point, view: ViewTransform, image: Size): Rect | null {
  if (Math.abs(end.x - start.x) < MIN_DRAG_PX && Math.abs(end.y - start.y) < MIN_DRAG_PX) return null;
  const raw = normalizeRect(toImage(start, view), toImage(end, view));
  if (!isDrawable(raw)) return null;
  return roundRect(clampRect(raw, image));
}
