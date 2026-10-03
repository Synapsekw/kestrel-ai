import { describe, expect, it } from "vitest";
import { PIN_PX, liftedPosition, pinScale, worldPerPixelOrtho, worldPerPixelPerspective } from "./pins";

describe("pins", () => {
  it("measures world units per screen pixel for both cameras", () => {
    expect(worldPerPixelPerspective(60, 10, 1000)).toBeCloseTo((2 * Math.tan(Math.PI / 6) * 10) / 1000, 9);
    expect(worldPerPixelOrtho(5, -5, 2, 500)).toBeCloseTo(0.01, 9);
  });

  it("holds a pin at about 6 px whatever the distance", () => {
    const near = worldPerPixelPerspective(38, 5, 800);
    const far = worldPerPixelPerspective(38, 500, 800);
    // the radius on screen is scale * baseRadius / worldPerPixel
    expect((pinScale(near, 1) * 1) / near).toBeCloseTo(PIN_PX, 6);
    expect((pinScale(far, 1) * 1) / far).toBeCloseTo(PIN_PX, 6);
    expect(pinScale(0.01, 0.5, 8)).toBeCloseTo(0.16, 9);
  });

  it("lifts a pin off its surface along the normal", () => {
    expect(liftedPosition([1, 2, 3], [0, 2, 0], 0.5)).toEqual([1, 2.5, 3]);
    expect(liftedPosition([1, 2, 3], null, 0.5)).toEqual([1, 2, 3]);
    expect(liftedPosition([1, 2, 3], [0, 0, 0], 0.5)).toEqual([1, 2, 3]);
  });
});
