import { describe, expect, it } from "vitest";
import {
  frontView,
  isoView,
  jumpDistance,
  namedView,
  orbitStep,
  poseView,
  sideView,
  topOrtho,
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

describe("named views (spec §7 Views)", () => {
  const d = 1.1 * siteDiagonal(B);

  it("front looks north from the south, level, at 1.1 site diagonals", () => {
    const v = frontView(B);
    expect(v.position.x).toBeCloseTo(v.target.x, 9);
    expect(v.position.z).toBeCloseTo(v.target.z, 9);
    expect(v.target.y - v.position.y).toBeCloseTo(d, 6);
  });

  it("side looks west from the east, level", () => {
    const v = sideView(B);
    expect(v.position.y).toBeCloseTo(v.target.y, 9);
    expect(v.position.z).toBeCloseTo(v.target.z, 9);
    expect(v.position.x - v.target.x).toBeCloseTo(d, 6);
  });

  it("iso looks from the south-east at 35 degrees", () => {
    const v = isoView(B);
    const dx = v.position.x - v.target.x;
    const dy = v.position.y - v.target.y;
    const dz = v.position.z - v.target.z;
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeCloseTo(-dx, 6);
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(d, 6);
    expect((Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI).toBeCloseTo(35, 9);
  });

  it("namedView maps every name, fit and top to S1's views", () => {
    expect(namedView("fit", B)).toEqual(wholeSiteView(B));
    expect(namedView("top", B)).toEqual(topView(B));
    expect(namedView("front", B)).toEqual(frontView(B));
    expect(namedView("side", B)).toEqual(sideView(B));
    expect(namedView("iso", B)).toEqual(isoView(B));
  });
});

describe("pose view", () => {
  const pose = { position: [10, 20, 30], target: [10, 25, 30], up: [0, 0, 1], fov_deg: 50 };

  it("turns a stored pose into a camera placement", () => {
    expect(poseView(pose)).toEqual({
      position: { x: 10, y: 20, z: 30 },
      target: { x: 10, y: 25, z: 30 },
      up: { x: 0, y: 0, z: 1 },
      fovDeg: 50,
    });
  });

  it("refuses a malformed pose instead of moving the camera somewhere absurd", () => {
    expect(poseView({ ...pose, position: [1, 2] })).toBeNull();
    expect(poseView({ ...pose, target: [1, Number.NaN, 3] })).toBeNull();
    expect(poseView({ ...pose, fov_deg: 0 })).toBeNull();
    expect(poseView({ ...pose, fov_deg: 180 })).toBeNull();
    expect(poseView({ ...pose, target: pose.position })).toBeNull();
  });
});

describe("top snapshot camera", () => {
  it("frames the bounds from above with the long side at px", () => {
    const t = topOrtho([0, 0, -5, 200, 100, 20], 512);
    expect([t.width, t.height]).toEqual([512, 256]);
    expect([t.halfWidth, t.halfHeight]).toEqual([100, 50]);
    expect(t.position).toEqual({ x: 100, y: 50, z: 30 });
    expect(t.target).toEqual({ x: 100, y: 50, z: -5 });
    expect(t.far).toBeCloseTo(45, 9);
  });

  it("topOrtho keeps at least one pixel for a flat or one-line cloud and clamps px", () => {
    const line = topOrtho([0, 0, 0, 100, 0, 0], 512);
    expect(line.width).toBe(512);
    expect(line.height).toBe(1);
    expect(topOrtho(B, 1e6).width).toBeLessThanOrEqual(2048);
    expect(topOrtho(B, 1).width).toBeGreaterThanOrEqual(16);
  });
});

describe("orbit step", () => {
  it("turns the camera about the vertical through the target, keeping height and range", () => {
    const p = orbitStep({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
    expect(p.z).toBe(5);
  });
});
