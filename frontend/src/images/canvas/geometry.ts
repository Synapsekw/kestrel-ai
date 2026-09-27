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
 * The box a drag draws, or `null` for a click, a few pixels of jitter or a degenerate rectangle.
 * `anchor` is the image pixel captured at mouse down, so a zoom or pan mid-drag leaves it in place;
 * `start`/`end` are the display points that decide whether the pointer moved at all; `view` is the
 * current transform for the pointer. The minimum-size check runs on the raw drag, before clamping,
 * because `clampRect` would otherwise turn a click into a 2 x 2 box.
 */
export function dragRect(
  anchor: Point,
  start: Point,
  end: Point,
  view: ViewTransform,
  image: Size,
): Rect | null {
  if (Math.abs(end.x - start.x) < MIN_DRAG_PX && Math.abs(end.y - start.y) < MIN_DRAG_PX) return null;
  const raw = normalizeRect(anchor, toImage(end, view));
  if (!isDrawable(raw)) return null;
  return roundRect(clampRect(raw, image));
}

/** A box plus its rotation. `x, y, w, h` always describe the *unrotated* box. */
export interface OrientedRect extends Rect {
  /** Degrees about the box centre, clockwise in image coordinates, in [0, 180). */
  angle: number;
}

/** Smallest angle change worth saving, in degrees. */
export const ANGLE_EPSILON = 0.05;

/** Degrees into [0, 180). A rectangle has 180 degree symmetry, so 190 and 10 are one shape. */
export function normaliseAngle(deg: number): number {
  const m = deg % 180;
  return m < 0 ? m + 180 : m;
}

export function centreOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The four corners in image pixels, clockwise from the rotated top-left. */
export function cornersOf(r: OrientedRect): [Point, Point, Point, Point] {
  const c = centreOf(r);
  const rad = (r.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dy: number): Point => ({
    x: c.x + dx * cos - dy * sin,
    y: c.y + dx * sin + dy * cos,
  });
  const hw = r.w / 2;
  const hh = r.h / 2;
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/** The axis-aligned envelope of the rotated box. */
export function aabbOf(r: OrientedRect): Rect {
  if (r.angle === 0) return { x: r.x, y: r.y, w: r.w, h: r.h };
  const pts = cornersOf(r);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Angle 0 clamps exactly as `clampRect` does; a rotated box only has its centre pulled into the
 * image. Forcing a rotated box's corners inside would shrink or shove it whenever the annotator
 * rotated near an edge, and an object half out of frame is the case aerial frames are full of.
 */
export function clampOriented(r: OrientedRect, image: Size): OrientedRect {
  if (r.angle === 0) return { ...clampRect(rectOf(r), image), angle: 0 };
  const w = Math.min(Math.max(r.w, MIN_BOX_SIDE), image.width);
  const h = Math.min(Math.max(r.h, MIN_BOX_SIDE), image.height);
  const c = centreOf({ ...r, w, h });
  const cx = Math.min(Math.max(c.x, 0), image.width);
  const cy = Math.min(Math.max(c.y, 0), image.height);
  return { x: cx - w / 2, y: cy - h / 2, w, h, angle: normaliseAngle(r.angle) };
}

/**
 * `eps` is the tolerance in image pixels for x/y/w/h; the angle always uses `ANGLE_EPSILON`,
 * because degrees and pixels are not the same unit and one number cannot serve both.
 */
export function orientedEquals(a: OrientedRect, b: OrientedRect, eps = 0.05): boolean {
  return rectEquals(rectOf(a), rectOf(b), eps) && Math.abs(a.angle - b.angle) < ANGLE_EPSILON;
}

export function orientedRectOf(b: {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}): OrientedRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h, angle: b.angle };
}

export function roundOriented(r: OrientedRect, decimals = 1): OrientedRect {
  const f = 10 ** decimals;
  return { ...roundRect(rectOf(r), decimals), angle: Math.round(normaliseAngle(r.angle) * f) / f };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function snapAngle(deg: number, step: number): number {
  return Math.round(deg / step) * step;
}

/** `b` moved so the direction a→b is a multiple of `step` degrees; the length is kept. */
export function snapDirection(a: Point, b: Point, step: number): Point {
  const len = distance(a, b);
  if (len === 0) return b;
  const deg = snapAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, step);
  const rad = (deg * Math.PI) / 180;
  return { x: a.x + len * Math.cos(rad), y: a.y + len * Math.sin(rad) };
}

/**
 * The rotated box of the three-point gesture (spec I-D8): a→b is one edge (its direction is the
 * angle, its length `w`), and the signed distance of `c` from that edge's line is the width `h`,
 * on c's side. `null` when either side is shorter than MIN_BOX_SIDE. The result is an
 * OrientedRect (x, y, w, h of the unrotated box, angle in [0, 180)).
 */
export function rboxFromThreePoints(a: Point, b: Point, c: Point): OrientedRect | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_BOX_SIDE) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const d = (c.x - a.x) * nx + (c.y - a.y) * ny;
  if (Math.abs(d) < MIN_BOX_SIDE) return null;
  const cx = (a.x + b.x) / 2 + (nx * d) / 2;
  const cy = (a.y + b.y) / 2 + (ny * d) / 2;
  const h = Math.abs(d);
  return { x: cx - len / 2, y: cy - h / 2, w: len, h, angle: normaliseAngle((Math.atan2(dy, dx) * 180) / Math.PI) };
}

export function envelopeOf(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** API polygon points (`[[x, y], …]`) to Points. */
export function toPoints(raw: readonly (readonly number[])[]): Point[] {
  return raw.map(([x, y]) => ({ x, y }));
}

/** Points to API polygon points, rounded (0.1 px by default, the server's precision). */
export function fromPoints(points: readonly Point[], decimals = 1): number[][] {
  const f = 10 ** decimals;
  return points.map((p) => [Math.round(p.x * f) / f, Math.round(p.y * f) / f]);
}

/** Konva's flat `[x0, y0, x1, y1, …]`. */
export function flatten(points: readonly Point[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

export function distanceToSegment(p: Point, a: Point, b: Point): { distance: number; at: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const at = { x: a.x + t * dx, y: a.y + t * dy };
  return { distance: distance(p, at), at };
}

/** The closed ring's edge nearest to `p`; edge `i` runs from points[i] to points[(i + 1) % n]. */
export function nearestEdge(
  points: readonly Point[],
  p: Point,
): { index: number; distance: number; at: Point } | null {
  if (points.length < 2) return null;
  let best: { index: number; distance: number; at: Point } | null = null;
  for (let i = 0; i < points.length; i++) {
    const hit = distanceToSegment(p, points[i], points[(i + 1) % points.length]);
    if (!best || hit.distance < best.distance) best = { index: i, ...hit };
  }
  return best;
}

export function translatePoints(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function clampPoint(p: Point, image: Size): Point {
  return { x: Math.min(Math.max(p.x, 0), image.width), y: Math.min(Math.max(p.y, 0), image.height) };
}
