import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { defaultColour, defaultElevationRange, makeMaterialOptions } from "./materialOptions";

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
