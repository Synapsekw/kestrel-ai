import { distanceToSegment, flatten, toPoints, type Point } from "./geometry";

/** Spec §9.1: simplify to 0.75 screen px for the zoom bucket. */
export const LOD_TOLERANCE_PX = 0.75;

/** Zoom buckets are powers of √2: bucket b covers scales around √2^b. */
export function bucketOf(scale: number): number {
  return Math.round(Math.log(scale) / Math.log(Math.SQRT2));
}

export function bucketScale(bucket: number): number {
  return Math.SQRT2 ** bucket;
}

/** Iterative Douglas–Peucker on the ring opened at vertex 0; never fewer than 3 vertices. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n <= 3) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b]).distance;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index !== -1 && max > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out = points.filter((_, i) => keep[i] === 1);
  return out.length >= 3 ? out : [...points];
}

const memo = new WeakMap<number[][], Map<number, number[]>>();

/**
 * The polygon's flat Konva points for a zoom bucket, simplified to LOD_TOLERANCE_PX on screen.
 * Memoised per (points array, bucket): an edit replaces the Box and its `points`, so the old
 * entry is released with it (WeakMap).
 */
export function lodPoints(points: number[][], bucket: number): number[] {
  let byBucket = memo.get(points);
  if (!byBucket) {
    byBucket = new Map();
    memo.set(points, byBucket);
  }
  const hit = byBucket.get(bucket);
  if (hit) return hit;
  const flat = flatten(simplify(toPoints(points), LOD_TOLERANCE_PX / bucketScale(bucket)));
  byBucket.set(bucket, flat);
  return flat;
}
