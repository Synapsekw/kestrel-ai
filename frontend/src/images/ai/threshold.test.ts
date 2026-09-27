import { afterEach, describe, expect, it } from "vitest";
import { clampThreshold, readThreshold, stepThreshold, writeThreshold } from "./threshold";

afterEach(() => localStorage.clear());

describe("threshold", () => {
  it("steps by 0.05 within 0 and 0.95 without float drift", () => {
    expect(stepThreshold(0.25, 1)).toBe(0.3);
    expect(stepThreshold(0, -1)).toBe(0);
    expect(stepThreshold(0.95, 1)).toBe(0.95);
    expect(stepThreshold(0.1, 1)).toBe(0.15);
    expect(clampThreshold(3)).toBe(0.95);
  });
  it("is kept per project", () => {
    writeThreshold("p1", 0.4);
    expect(readThreshold("p1")).toBe(0.4);
    expect(readThreshold("p2")).toBe(0);
  });
  it("falls back to 0 on a corrupt or out-of-range value", () => {
    localStorage.setItem("kestrel.images.threshold.p1", "abc");
    expect(readThreshold("p1")).toBe(0);
    localStorage.setItem("kestrel.images.threshold.p1", "7");
    expect(readThreshold("p1")).toBe(0.95);
  });
  it("survives a storage that throws", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("denied");
    };
    try {
      expect(readThreshold("p1")).toBe(0);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});
