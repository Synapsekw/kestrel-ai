import { describe, expect, it } from "vitest";
import { shapeBounds } from "./panTo";

describe("shapeBounds", () => {
  it("box is its rect", () => {
    expect(shapeBounds({ shape: "box", x: 10, y: 20, w: 30, h: 40, angle: 0 })).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
  });
  it("rbox at 90° swaps the extent about the centre", () => {
    const r = shapeBounds({ shape: "rbox", x: 0, y: 0, w: 100, h: 20, angle: 90 });
    expect(r.x).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(-40);
    expect(r.w).toBeCloseTo(20);
    expect(r.h).toBeCloseTo(100);
  });
  it("polygon uses its points", () => {
    expect(
      shapeBounds({
        shape: "polygon",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        angle: 0,
        points: [
          [5, 5],
          [15, 7],
          [9, 25],
        ],
      }),
    ).toEqual({ x: 5, y: 5, w: 10, h: 20 });
  });
  it("point gets a pad", () => {
    expect(shapeBounds({ shape: "point", x: 100, y: 50, w: 0, h: 0, angle: 0 })).toEqual({
      x: 76,
      y: 26,
      w: 48,
      h: 48,
    });
  });
});
