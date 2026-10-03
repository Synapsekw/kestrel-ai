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
});

describe("shoreField", () => {
  it("encodes metres to land as 0..255 over 0..64 m", () => {
    const f = shoreField(LEFT, BOX, 8)!;
    expect(f[8 * 3 + 3]).toBe(0); // land
    expect(f[8 * 3 + 4]).toBe(Math.round((255 * 1) / 64)); // 1 m from land
  });
  it("is null without land, or with land outside the sea's box: no shoreline, no foam", () => {
    expect(shoreField([], BOX, 8)).toBeNull();
    expect(shoreField([20, 20, 30, 20, 30, 30], BOX, 8)).toBeNull();
  });
});
