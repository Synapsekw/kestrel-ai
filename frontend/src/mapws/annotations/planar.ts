/** Planar geometry in the site frame (metres). Display only: stored results come from the server. */

type Pt = readonly number[];

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Drops consecutive repeated vertices (a finishing double-click lands its point twice). */
export function dedupe(coords: readonly Pt[]): number[][] {
  const out: number[][] = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || !same(last, c)) out.push([c[0], c[1]]);
  }
  return out;
}

export function polylineLength(pts: readonly Pt[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return sum;
}

export function openRing(ring: readonly Pt[]): number[][] {
  const pts = dedupe(ring);
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

export function closeRing(ring: readonly Pt[]): number[][] {
  const pts = openRing(ring);
  return pts.length ? [...pts, [pts[0][0], pts[0][1]]] : pts;
}

function signedArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a / 2;
}

export function ringArea(ring: readonly Pt[]): number {
  return Math.abs(signedArea(openRing(ring)));
}

export function ringPerimeter(ring: readonly Pt[]): number {
  return polylineLength(closeRing(ring));
}

/** The area centroid of a ring; the vertex mean for a point, a line or a degenerate ring. */
export function centroid(pts: readonly Pt[]): [number, number] {
  const r = openRing(pts);
  if (r.length === 0) return [Number.NaN, Number.NaN];
  const a = r.length >= 3 ? signedArea(r) : 0;
  if (Math.abs(a) > 1e-12) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length;
      const f = r[i][0] * r[j][1] - r[j][0] * r[i][1];
      cx += (r[i][0] + r[j][0]) * f;
      cy += (r[i][1] + r[j][1]) * f;
    }
    return [cx / (6 * a), cy / (6 * a)];
  }
  return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
}

/** `extent` is `[minx, miny, maxx, maxy]` (W1's SiteExtent). */
export function inExtent(p: Pt, extent: readonly number[]): boolean {
  return p[0] >= extent[0] && p[0] <= extent[2] && p[1] >= extent[1] && p[1] <= extent[3];
}

/** The point `d` metres along the line, clamped to its ends. */
export function pointAlong(line: readonly Pt[], d: number): [number, number] {
  if (line.length === 0) return [Number.NaN, Number.NaN];
  if (d <= 0) return [line[0][0], line[0][1]];
  let left = d;
  for (let i = 1; i < line.length; i++) {
    const seg = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (seg > 0 && left <= seg) {
      const t = left / seg;
      return [
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
      ];
    }
    left -= seg;
  }
  const last = line[line.length - 1];
  return [last[0], last[1]];
}

/** The chainage of the point on the line nearest to `p`. */
export function distanceAlong(line: readonly Pt[], p: Pt): number {
  let best = Number.POSITIVE_INFINITY;
  let at = 0;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const dx = line[i][0] - ax;
    const dy = line[i][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
    if (d < best) {
      best = d;
      at = walked + t * Math.sqrt(len2);
    }
    walked += Math.sqrt(len2);
  }
  return at;
}
