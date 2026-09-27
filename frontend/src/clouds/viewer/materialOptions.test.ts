import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import {
  DEFAULT_INTENSITY_RANGE,
  POINT_COLOR_TYPE,
  defaultColour,
  defaultElevationRange,
  makeMaterialOptions,
} from "./materialOptions";

describe("material options", () => {
  it("pins colour encoding 1/1 (the white-colour trap) and adaptive points", () => {
    const o = makeMaterialOptions({ colour: "rgb", elevationRange: [0, 10], pointSize: 1 });
    expect(o.inputColorEncoding).toBe(1);
    expect(o.outputColorEncoding).toBe(1);
    expect(o.pointSizeType).toBe(2);
    expect(o.pointColorType).toBe(0);
  });

  it("uses the HEIGHT colour type for elevation and clamps the point size", () => {
    expect(makeMaterialOptions({ colour: "elevation", elevationRange: [1, 2], pointSize: 9 })).toMatchObject({
      pointColorType: 3,
      size: 3,
      elevationRange: [1, 2],
    });
    expect(makeMaterialOptions({ colour: "rgb", elevationRange: [1, 2], pointSize: 0 }).size).toBe(0.5);
  });

  it("defaults to elevation without RGB, and to the p1-p99 range", () => {
    expect(defaultColour(true)).toBe("rgb");
    expect(defaultColour(false)).toBe("elevation");
    expect(defaultColour(null)).toBe("elevation");
    expect(defaultElevationRange(exampleCloud)).toEqual([-44.0, 170.0]);
    expect(defaultElevationRange({ ...exampleCloud, z_stats: null })).toEqual([-45, 175]);
  });
});

describe("colour modes (spec §7 Colour)", () => {
  it("maps the four modes to potree's pointColorType: RGB 0, HEIGHT 3, INTENSITY 4, CLASSIFICATION 8", () => {
    expect(POINT_COLOR_TYPE).toEqual({ rgb: 0, elevation: 3, intensity: 4, classification: 8 });
    for (const colour of ["rgb", "elevation", "intensity", "classification"] as const) {
      expect(makeMaterialOptions({ colour, elevationRange: [0, 1], pointSize: 1 }).pointColorType).toBe(
        POINT_COLOR_TYPE[colour],
      );
    }
  });

  it("carries the intensity range, 0-65535 until one is sampled", () => {
    expect(
      makeMaterialOptions({ colour: "intensity", elevationRange: [0, 1], pointSize: 1 }).intensityRange,
    ).toEqual(DEFAULT_INTENSITY_RANGE);
    expect(
      makeMaterialOptions({
        colour: "intensity",
        elevationRange: [0, 1],
        pointSize: 1,
        intensityRange: [5, 900],
      }).intensityRange,
    ).toEqual([5, 900]);
  });
});
