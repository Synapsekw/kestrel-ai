import { describe, expect, it } from "vitest";
import { DEFAULT_FOCUS, focusView } from "./focus";

const norm = (v: number[]) => Math.hypot(...v);

describe("focusView", () => {
  it("looks straight along a patch normal with the frustum clamped to the profile", () => {
    const small = focusView({ kind: "patch", center: [10, 20, 0], normal: [2, 0, 0], size: 2 }, 100);
    expect(small.target).toEqual([10, 20, 0]);
    expect(small.direction[0]).toBeCloseTo(1);
    expect(small.direction[1]).toBeCloseTo(0);
    expect(small.viewHeight).toBeCloseTo(7.2); // 2 * 3.6, inside [5, 12.5]
    expect(small.distance).toBeCloseTo(72.5); // H * 0.225 + 50
    expect(
      focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 10 }, 100).viewHeight,
    ).toBeCloseTo(12.5);
    expect(
      focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 0.1 }, 100).viewHeight,
    ).toBeCloseTo(5);
  });

  it("turns off the surface and looks slightly down with an oblique profile", () => {
    const v = focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 2 }, 100, {
      frustum: DEFAULT_FOCUS.frustum,
      oblique_deg: 20,
    });
    expect(norm(v.direction)).toBeCloseTo(1);
    expect(v.direction[0]).toBeGreaterThan(0.9);
    expect(v.direction[2]).toBeLessThan(0); // rotated clockwise seen from above
    expect(v.direction[1]).toBeGreaterThan(0.15); // tan(11 deg) before normalising
  });

  it("aims a pin without a normal from its photo, never from below", () => {
    const v = focusView(
      { kind: "point", center: [0, 10, 10], normal: null, size: 0, cameraPosition: [0, 5, 50] },
      100,
    );
    expect(v.direction).toEqual([0, 0, 1]);
    expect(v.viewHeight).toBeCloseTo(7.2); // H * 0.02 * 3.6
  });

  it("falls back to the outward horizontal from the axis when nothing else is known", () => {
    const v = focusView({ kind: "point", center: [0, 4, -3], normal: null, size: 0 }, 50);
    expect(v.direction[2]).toBeCloseTo(-1);
    const axis = focusView({ kind: "point", center: [0, 4, 0], normal: null, size: 0 }, 50);
    expect(axis.direction).toEqual([1, 0, 0]);
  });
});
