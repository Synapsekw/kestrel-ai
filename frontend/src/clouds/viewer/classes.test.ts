// frontend/src/clouds/viewer/classes.test.ts
import { describe, expect, it } from "vitest";
import { ASPRS_CLASSES, classLabel, classificationLut } from "./classes";

describe("ASPRS classification LUT (spec §7, viewer/classes.ts)", () => {
  it("names the standard classes", () => {
    expect(classLabel(2)).toBe("Ground");
    expect(classLabel(3)).toBe("Low vegetation");
    expect(classLabel(5)).toBe("High vegetation");
    expect(classLabel(6)).toBe("Building");
    expect(classLabel(9)).toBe("Water");
    expect(classLabel(17)).toBe("Bridge deck");
    expect(classLabel(64)).toBe("Class 64");
    expect(new Set(ASPRS_CLASSES.map((c) => c.code)).size).toBe(ASPRS_CLASSES.length);
  });

  it("gives every class an opaque colour in 0..1 and a DEFAULT for the rest", () => {
    const lut = classificationLut();
    expect(Object.keys(lut)).toContain("DEFAULT");
    for (const c of ASPRS_CLASSES) {
      const v = lut[String(c.code)];
      expect(v).toHaveLength(4);
      expect(v.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(v[3]).toBe(1);
    }
    expect(lut["6"].slice(0, 3)).not.toEqual(lut["2"].slice(0, 3)); // building is not ground
  });

  it("hides a class by alpha 0, which potree's shader culls in classification mode", () => {
    const lut = classificationLut(new Set([2, 7]));
    expect(lut["2"][3]).toBe(0);
    expect(lut["7"][3]).toBe(0);
    expect(lut["6"][3]).toBe(1);
  });
});
