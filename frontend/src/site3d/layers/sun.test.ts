import { describe, expect, it } from "vitest";
import { sunDirection } from "./sun";

describe("sunDirection (scene: x plant north, y up, z plant east)", () => {
  it("azimuth 0 on the horizon is plant north", () => {
    const d = sunDirection(0, 0);
    expect([d.x, d.y, d.z].map((v) => +v.toFixed(9))).toEqual([1, 0, 0]);
  });
  it("azimuth 90 is plant east", () => {
    const d = sunDirection(0, 90);
    expect([d.x, d.y, d.z].map((v) => +v.toFixed(9))).toEqual([0, 0, 1]);
  });
  it("elevation 90 is straight up, and the default is a unit vector above the horizon", () => {
    expect(sunDirection(90, 123).y).toBeCloseTo(1, 9);
    const d = sunDirection();
    expect(d.length()).toBeCloseTo(1, 9);
    expect(d.y).toBeGreaterThan(0.5);
  });
});
