import { describe, expect, it } from "vitest";
import {
  jumpDistance,
  nearFar,
  siteDiagonal,
  southOblique,
  topView,
  wholeSiteView,
  type Bounds6,
} from "./camera";

const B: Bounds6 = [243194, 3177915, -141, 243895, 3178616, 560];

describe("camera maths", () => {
  it("near and far follow the target distance and the site", () => {
    const d = siteDiagonal(B);
    expect(nearFar(10, d)).toEqual({ near: 0.05, far: 20 * d });
    expect(nearFar(1000, d).near).toBe(0.5);
    expect(nearFar(1e6, d).far).toBeGreaterThan(1e6);
  });

  it("puts the camera 45 degrees up from the south", () => {
    const p = southOblique({ x: 0, y: 0, z: 0 }, 100);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(-70.7107, 3);
    expect(p.z).toBeCloseTo(70.7107, 3);
  });

  it("frames the whole site from the south and the top", () => {
    const w = wholeSiteView(B);
    expect(w.target.x).toBeCloseTo((B[0] + B[3]) / 2);
    expect(w.position.y).toBeLessThan(w.target.y);
    expect(w.position.z).toBeGreaterThan(w.target.z);
    const t = topView(B);
    expect(t.position.x).toBeCloseTo(t.target.x);
    expect(t.position.z - t.target.z).toBeGreaterThan(B[3] - B[0]);
  });

  it("jumps to at least 40 m, else three footprint diagonals", () => {
    expect(jumpDistance(0)).toBe(40);
    expect(jumpDistance(20)).toBe(60);
  });
});
