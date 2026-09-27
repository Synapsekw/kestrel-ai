import { describe, expect, it } from "vitest";
import { bucketOf, bucketScale, lodPoints, simplify } from "./lod";

const circle = (n: number, r: number): number[][] =>
  Array.from({ length: n }, (_, i) => [
    500 + r * Math.cos((2 * Math.PI * i) / n),
    500 + r * Math.sin((2 * Math.PI * i) / n),
  ]);

describe("zoom buckets (powers of √2)", () => {
  it.each([
    [1, 0],
    [Math.SQRT2, 1],
    [2, 2],
    [0.5, -2],
    [1.2, 1],
  ])("scale %f is bucket %i", (scale, bucket) => {
    expect(bucketOf(scale)).toBe(bucket);
  });

  it("maps a bucket back to its scale", () => {
    expect(bucketScale(2)).toBeCloseTo(2);
    expect(bucketScale(-2)).toBeCloseTo(0.5);
  });
});

describe("Douglas–Peucker", () => {
  it("drops a vertex that deviates less than the tolerance and keeps the corners", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(simplify(pts, 0.75)).toEqual([pts[0], pts[2], pts[3], pts[4]]);
  });

  it("never returns fewer than three vertices", () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0, y: 0.1 },
    ];
    expect(simplify(tiny, 5).length).toBeGreaterThanOrEqual(3);
  });
});

describe("lodPoints per bucket", () => {
  const ring = circle(400, 200);

  it("uses fewer vertices when zoomed out than when zoomed in", () => {
    const far = lodPoints(ring, bucketOf(1 / 8)).length / 2;
    const near = lodPoints(ring, bucketOf(4)).length / 2;
    expect(far).toBeLessThan(near);
    expect(near).toBeLessThanOrEqual(400);
    expect(far).toBeGreaterThanOrEqual(3);
  });

  it("keeps the ring's first vertex", () => {
    const bucket = bucketOf(0.25);
    const flat = lodPoints(ring, bucket);
    const kept = new Set<string>();
    for (let i = 0; i < flat.length; i += 2) kept.add(`${flat[i]},${flat[i + 1]}`);
    expect(kept.has(`${ring[0][0]},${ring[0][1]}`)).toBe(true);
  });

  it("is memoised per (points, bucket)", () => {
    expect(lodPoints(ring, 0)).toBe(lodPoints(ring, 0));
    expect(lodPoints(ring, 0)).not.toBe(lodPoints(ring, 2));
    expect(lodPoints([...ring], 0)).not.toBe(lodPoints(ring, 0));
  });
});
