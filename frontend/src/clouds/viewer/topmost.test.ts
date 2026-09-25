import { describe, expect, it } from "vitest";
import { nearestToCentre, topmostWithin, windowHits } from "./topmost";

/** RGBA pixels, row by row: [r, g, b, a] each. */
const px = (...pixels: number[][]) => new Uint8Array(pixels.flat());
const EMPTY = [0, 0, 0, 0];

describe("windowHits", () => {
  it("reads every drawn point once: rgb is the point index, alpha the node index + 1", () => {
    // a 2 x 2 window: nothing, point 261 of node 0 twice (a splat covers several pixels), point
    // 7 + 2 * 65536 of node 2
    const hits = windowHits(px(EMPTY, [5, 1, 0, 1], [5, 1, 0, 1], [7, 0, 2, 3]), 2);
    expect(hits.map(({ pIndex, pcIndex }) => ({ pIndex, pcIndex }))).toEqual([
      { pIndex: 261, pcIndex: 0 },
      { pIndex: 131079, pcIndex: 2 },
    ]);
  });

  it("keeps each point's pixel nearest the centre, as potree measures it", () => {
    // 3 x 3: point 1 at a corner and at the centre, point 2 at an edge
    const P1 = [1, 0, 0, 1];
    const P2 = [2, 0, 0, 1];
    const hits = windowHits(px(P1, P2, EMPTY, EMPTY, P1, EMPTY, EMPTY, EMPTY, EMPTY), 3);
    expect(hits).toEqual([
      { pIndex: 1, pcIndex: 0, d2: 0 },
      { pIndex: 2, pcIndex: 0, d2: 1 },
    ]);
  });
});

describe("nearestToCentre", () => {
  it("takes the smallest pixel distance; null for none", () => {
    expect(nearestToCentre([{ d2: 4 }, { d2: 1 }, { d2: 2 }])).toEqual({ d2: 1 });
    expect(nearestToCentre([])).toBeNull();
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

  it("takes the highest hit near the spot, not the one nearest it", () => {
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

  it("a taller neighbour 1.8 m away does not set the height when there is a hit at the spot", () => {
    // the chimney's "open ground" spot: dense sky noise at z 130-160 m 1.9 m away, ground at the spot
    const noise = { x: 1.9, y: 0, z: 158.85 };
    expect(topmostWithin([{ x: 0.1, y: 0, z: -10 }, noise], 0, 0, 2)).toEqual({ x: 0.1, y: 0, z: -10 });
  });

  it("widens ring by ring (a quarter, a half, 1, 2 m) until one holds a hit", () => {
    const wall = { x: 1.8, y: 0, z: 3 };
    expect(topmostWithin([wall], 0, 0, 2)).toEqual(wall);
    expect(topmostWithin([{ x: 0.9, y: 0, z: 0 }, wall], 0, 0, 2)).toEqual({ x: 0.9, y: 0, z: 0 });
  });

  it("a coarse point whose reach covers the spot counts as at the spot", () => {
    // the arrival first looks at p50, 230 m below the rim: the rim is loaded coarsely (level 3, u
    // 0.68 m) and the nearest rim point is 0.6 m off, while the floor is loaded finely 0.1 m off
    const rim = { x: 0.6, y: 0, z: 188.8, reach: 0.68 };
    const floorNear = { x: 0.1, y: 0, z: -41.6, reach: 0.09 };
    expect(topmostWithin([floorNear, rim], 0, 0, 2)).toEqual(rim);
    // a reach never stretches past the radius
    expect(topmostWithin([{ x: 2.5, y: 0, z: 9, reach: 5 }], 0, 0, 2)).toBeNull();
  });

  it("answers null for no hits", () => {
    expect(topmostWithin([], 0, 0, 2)).toBeNull();
  });
});
