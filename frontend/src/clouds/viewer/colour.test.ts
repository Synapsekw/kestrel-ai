// frontend/src/clouds/viewer/colour.test.ts
import { describe, expect, it } from "vitest";
import {
  INTENSITY_SAMPLE_MAX,
  attributeNames,
  colourAvailability,
  effectiveColour,
  intensityRange,
  sampleEvery,
} from "./colour";

describe("colour availability from the octree's point attributes", () => {
  it("reads the attribute names of a Potree 2.0 geometry, lower-cased", () => {
    const geometry = {
      pointAttributes: { attributes: [{ name: "position" }, { name: "RGB" }, { name: "intensity" }] },
    };
    expect(attributeNames(geometry)).toEqual(["position", "rgb", "intensity"]);
  });

  it("answers no names for a geometry without attributes, or garbage", () => {
    expect(attributeNames(null)).toEqual([]);
    expect(attributeNames({})).toEqual([]);
    expect(attributeNames({ pointAttributes: { attributes: [{ name: 3 }, null] } })).toEqual([]);
  });

  it("enables a mode only when its attribute is there; elevation always", () => {
    expect(colourAvailability(["position", "rgb"])).toEqual({
      rgb: true,
      elevation: true,
      intensity: false,
      classification: false,
    });
    expect(colourAvailability(["position", "intensity", "classification"])).toEqual({
      rgb: false,
      elevation: true,
      intensity: true,
      classification: true,
    });
  });

  it("falls back to elevation for a mode the cloud lacks", () => {
    const a = colourAvailability(["position", "rgb"]);
    expect(effectiveColour("intensity", a)).toBe("elevation");
    expect(effectiveColour("classification", a)).toBe("elevation");
    expect(effectiveColour("rgb", a)).toBe("rgb");
    expect(effectiveColour("rgb", colourAvailability(["position"]))).toBe("elevation");
    expect(effectiveColour("intensity", null)).toBe("intensity"); // before load nothing is drawn
  });
});

describe("intensity range: p2-p98 of a bounded sample (spec §7)", () => {
  const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

  it("takes p2 and p98 across every array", () => {
    expect(intensityRange([ramp(0, 10_000)])).toEqual([200, 9799]);
    expect(intensityRange([ramp(0, 5_000), ramp(5_000, 5_000)])).toEqual([200, 9799]);
  });

  it("never samples more than 100 000 values", () => {
    expect(INTENSITY_SAMPLE_MAX).toBe(100_000);
    const big = [ramp(0, 600_000), ramp(600_000, 450_001)];
    const s = sampleEvery(big, INTENSITY_SAMPLE_MAX);
    expect(s.length).toBeLessThanOrEqual(INTENSITY_SAMPLE_MAX);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBeGreaterThan(1_000_000); // the stride reaches into the second array
  });

  it("a constant or NaN-laced sample still gives a finite range with lo < hi", () => {
    expect(intensityRange([new Float32Array(50).fill(7)])).toEqual([7, 8]);
    const r = intensityRange([Float32Array.from([Number.NaN, 1, 2, 3, Number.NaN])]);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r![0]) && Number.isFinite(r![1]) && r![0] < r![1]).toBe(true);
  });

  it("answers null with nothing to sample", () => {
    expect(intensityRange([])).toBeNull();
    expect(intensityRange([new Float32Array(0)])).toBeNull();
    expect(intensityRange([Float32Array.from([Number.NaN])])).toBeNull();
  });
});
