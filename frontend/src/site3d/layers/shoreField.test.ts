import { describe, expect, it } from "vitest";
import { chamferDistance, rasterTriangles, shoreField, type Box2 } from "./shoreField";

const BOX: Box2 = { minX: 0, minZ: 0, maxX: 8, maxZ: 8 };
// the left half (x 0..4) as two triangles, flat [x, z, x, z, x, z] pairs
const LEFT = [0, 0, 4, 0, 4, 8, 0, 0, 4, 8, 0, 8];

describe("rasterTriangles", () => {
  it("marks the cells whose centres fall in a triangle", () => {
    const m = rasterTriangles(LEFT, BOX, 8);
    expect(Array.from(m.slice(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(32);
  });
  it("ignores degenerate (zero-area) triangles: vertical walls projected flat", () => {
    expect(rasterTriangles([0, 0, 4, 0, 8, 0], BOX, 8).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("chamferDistance", () => {
  it("is 0 on the source and grows one cell per step away from it", () => {
    const d = chamferDistance(rasterTriangles(LEFT, BOX, 8), 8, 1);
    const row = Array.from(d.slice(8 * 3, 8 * 3 + 8));
    expect(row).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
  it("weighs x steps by cellM, z steps by cellZ and diagonals by their hypotenuse", () => {
    const src = new Uint8Array(9);
    src[0] = 1; // corner cell of a 3 by 3 grid
    const d = chamferDistance(src, 3, 2, 0.5);
    expect(d[1]).toBeCloseTo(2, 6); // one step in x
    expect(d[3]).toBeCloseTo(0.5, 6); // one step in z
    expect(d[4]).toBeCloseTo(Math.hypot(2, 0.5), 6); // one diagonal
  });
});

describe("shoreField", () => {
  it("encodes metres to land as 0..255 over 0..64 m", () => {
    const f = shoreField(LEFT, BOX, 8)!;
    expect(f[8 * 3 + 3]).toBe(0); // land
    expect(f[8 * 3 + 4]).toBe(Math.round((255 * 1) / 64)); // 1 m from land
  });
  it("measures metres along x and z separately on a non-square box", () => {
    // 16 m by 4 m over 8 cells: each texel is 2 m in x and 0.5 m in z
    const box: Box2 = { minX: 0, minZ: 0, maxX: 16, maxZ: 4 };
    const westHalf = [0, 0, 8, 0, 8, 4, 0, 0, 8, 4, 0, 4]; // x 0..8
    const fx = shoreField(westHalf, box, 8)!;
    expect(fx[8 * 3 + 4]).toBe(Math.round((255 * 2) / 64)); // one cell east: 2 m
    expect(fx[8 * 3 + 7]).toBe(Math.round((255 * 8) / 64)); // four cells east: 8 m
    const southHalf = [0, 0, 16, 0, 16, 2, 0, 0, 16, 2, 0, 2]; // z 0..2
    const fz = shoreField(southHalf, box, 8)!;
    expect(fz[8 * 4 + 3]).toBe(Math.round((255 * 0.5) / 64)); // one row north: 0.5 m
    expect(fz[8 * 7 + 3]).toBe(Math.round((255 * 2) / 64)); // four rows north: 2 m
  });
  it("is null without land, or with land outside the sea's box: no shoreline, no foam", () => {
    expect(shoreField([], BOX, 8)).toBeNull();
    expect(shoreField([20, 20, 30, 20, 30, 30], BOX, 8)).toBeNull();
  });
});
