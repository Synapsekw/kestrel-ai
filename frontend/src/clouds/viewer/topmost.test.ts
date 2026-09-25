import { describe, expect, it } from "vitest";
import { topmostWithin, windowHits } from "./topmost";

describe("windowHits", () => {
  it("reads every lit pixel once per point: rgb is the point index, alpha the node index + 1", () => {
    const px = new Uint8Array([
      0,
      0,
      0,
      0, // background
      5,
      1,
      0,
      1, // point 261 of node 0
      5,
      1,
      0,
      1, // the same point again (a splat covers several pixels)
      7,
      0,
      2,
      3, // point 7 + 2 * 65536 of node 2
    ]);
    expect(windowHits(px)).toEqual([
      { pIndex: 261, pcIndex: 0 },
      { pIndex: 131079, pcIndex: 2 },
    ]);
  });
});

describe("topmostWithin", () => {
  // §17.10 first acceptance: a thin chimney rim at z 188.8 around a hollow flue whose floor is at
  // z -41.6. Straight down at a spot on the rim, the floor seen through the gap between two loaded
  // rim points was the lit pixel nearest the centre, and potree's picker returned it.
  const ring = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return { x: 1.5 * Math.cos(a), y: 1.5 * Math.sin(a), z: 188.8 };
  });
  const floor = [
    { x: 1.45, y: 0.02, z: -41.6 },
    { x: 0, y: 0, z: -41.6 },
  ];

  it("takes the highest hit within the radius, not the one nearest the spot", () => {
    const hit = topmostWithin([...floor, ...ring], 1.46, 0, 2);
    expect(hit?.z).toBe(188.8);
  });

  it("ignores hits beyond the radius, however high", () => {
    const tower = { x: 3, y: 0, z: 500 };
    expect(topmostWithin([tower, ...floor], 0, 0, 2)?.z).toBe(-41.6);
    expect(topmostWithin([tower], 0, 0, 2)).toBeNull();
  });

  it("of the top surface, the point nearest the spot", () => {
    const hit = topmostWithin([...ring, ...floor], 1.46, 0, 2);
    expect(hit).toEqual(ring[0]); // (1.5, 0), not another rim point across the flue
  });

  it("stays at the spot on a gentle slope instead of the uphill edge", () => {
    const slope = [-2, -1, 0, 1, 2].flatMap((i) =>
      [-2, -1, 0, 1, 2].map((j) => ({ x: i, y: j, z: 0.02 * i })),
    );
    expect(topmostWithin(slope, 0, 0, 2)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("a structure more than half a metre taller within the radius sets the height", () => {
    const wall = { x: 1.8, y: 0, z: 3 };
    expect(topmostWithin([{ x: 0, y: 0, z: 0 }, wall], 0, 0, 2)).toEqual(wall);
    expect(
      topmostWithin(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1.8, y: 0, z: 0.4 },
        ],
        0,
        0,
        2,
      ),
    ).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("answers null for no hits", () => {
    expect(topmostWithin([], 0, 0, 2)).toBeNull();
  });
});
