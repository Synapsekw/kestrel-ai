import {
  applyAffine,
  fitGeoref,
  invertAffine,
  MAX_PAIRS,
  type Affine,
  type FitResult,
  type GeorefModelName,
  type Vec2,
} from "./fit";

export type Extent4 = [number, number, number, number];
export interface AlignPair {
  id: string;
  src: Vec2;
  dst: Vec2;
}
export interface SavedPlacement {
  transform: Affine;
  model: GeorefModelName;
  points: AlignPair[];
}
/** One K-tool session on one drawing (spec §8.3); dst and the transform are in the site frame. */
export interface AlignSession {
  drawingId: string;
  model: GeorefModelName;
  pairs: AlignPair[];
  /** The first click of a pair, in drawing coordinates, until the map click arrives. */
  pendingSrc: Vec2 | null;
  extentSrc: Extent4;
  /** The provisional placement or the saved georef the session started from. */
  start: Affine;
  /** What the preview shows: the live fit when valid, else the last good one. */
  transform: Affine;
  fit: FitResult | null;
  nextId: number;
  unitsScale: number | null;
}

export const PROVISIONAL_FILL = 0.6;
export const MISSED_DRAWING = "Click a point on the drawing first, then the same point on the map.";
export const TOO_MANY_PAIRS = "At most 12 pairs: delete one to add another.";

export function provisionalTransform(src: Extent4, viewport: Extent4): Affine {
  const w = Math.max(src[2] - src[0], 1e-9);
  const h = Math.max(src[3] - src[1], 1e-9);
  const s = PROVISIONAL_FILL * Math.min((viewport[2] - viewport[0]) / w, (viewport[3] - viewport[1]) / h);
  const cx = (viewport[0] + viewport[2]) / 2;
  const cy = (viewport[1] + viewport[3]) / 2;
  return [s, 0, cx - s * ((src[0] + src[2]) / 2), 0, s, cy - s * ((src[1] + src[3]) / 2)];
}

function refit(s: AlignSession): AlignSession {
  if (s.pairs.length === 0) return { ...s, fit: null, transform: s.start };
  const fit = fitGeoref(s.model, s.pairs, { unitsScale: s.unitsScale });
  return { ...s, fit, transform: fit.ok ? fit.transform : s.transform };
}

function nextIdAfter(pairs: readonly AlignPair[]): number {
  return pairs.reduce((m, p) => Math.max(m, Number(/^cp(\d+)$/.exec(p.id)?.[1] ?? 0)), 0) + 1;
}

export function startSession(o: {
  drawingId: string;
  extentSrc: Extent4;
  viewport: Extent4;
  saved: SavedPlacement | null;
  unitsScale: number | null;
}): AlignSession {
  const start = o.saved?.transform ?? provisionalTransform(o.extentSrc, o.viewport);
  const pairs = o.saved?.points ?? [];
  return refit({
    drawingId: o.drawingId,
    model: o.saved?.model ?? "similarity",
    pairs,
    pendingSrc: null,
    extentSrc: o.extentSrc,
    start,
    transform: start,
    fit: null,
    nextId: nextIdAfter(pairs),
    unitsScale: o.unitsScale,
  });
}

export function quadOf(t: Affine, e: Extent4): Vec2[] {
  const corners: Vec2[] = [
    [e[0], e[1]],
    [e[2], e[1]],
    [e[2], e[3]],
    [e[0], e[3]],
  ];
  return corners.map((p) => applyAffine(t, p));
}

/** The affine image of a rectangle is a convex parallelogram: a same-side test on every edge. */
export function pointInQuad(p: Vec2, q: readonly Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Preflight adaptation #4: at the 12-pair cap the refusal happens on the FIRST (drawing) click, not
 * the second — clearer, and there is never a stale pending bubble to clean up.
 */
export function clickAt(s: AlignSession, p: Vec2): { session: AlignSession; notice: string | null } {
  if (s.pendingSrc === null) {
    if (s.pairs.length >= MAX_PAIRS) return { session: s, notice: TOO_MANY_PAIRS };
    const inv = invertAffine(s.transform);
    if (!inv || !pointInQuad(p, quadOf(s.transform, s.extentSrc)))
      return { session: s, notice: MISSED_DRAWING };
    return { session: { ...s, pendingSrc: applyAffine(inv, p) }, notice: null };
  }
  const pair: AlignPair = { id: `cp${s.nextId}`, src: s.pendingSrc, dst: p };
  return {
    session: refit({
      ...s,
      pairs: [...s.pairs, pair],
      pendingSrc: null,
      nextId: s.nextId + 1,
    }),
    notice: null,
  };
}

export function removePair(s: AlignSession, id: string): AlignSession {
  return refit({ ...s, pairs: s.pairs.filter((p) => p.id !== id) });
}

/** Backspace / Ctrl+Z (R-W5-9): the pending click first, then the last pair. */
export function undoLast(s: AlignSession): AlignSession {
  if (s.pendingSrc) return { ...s, pendingSrc: null };
  return refit({ ...s, pairs: s.pairs.slice(0, -1) });
}

export function setModel(s: AlignSession, model: GeorefModelName): AlignSession {
  return refit({ ...s, model });
}

export interface OverlayMark {
  kind: "residual" | "src" | "dst" | "pending";
  n: number;
  coords: Vec2[];
}

/** Numbered bubbles and dashed residual lines for the map overlay (spec §8.3). */
export function overlayMarks(s: AlignSession): OverlayMark[] {
  const out: OverlayMark[] = [];
  s.pairs.forEach((p, i) => {
    const at = applyAffine(s.transform, p.src);
    out.push(
      { kind: "residual", n: i + 1, coords: [at, p.dst] },
      { kind: "src", n: i + 1, coords: [at] },
      { kind: "dst", n: i + 1, coords: [p.dst] },
    );
  });
  if (s.pendingSrc)
    out.push({
      kind: "pending",
      n: s.pairs.length + 1,
      coords: [applyAffine(s.transform, s.pendingSrc)],
    });
  return out;
}
