import { describe, it, expect } from "vitest";
import { computeWindow } from "./useVirtualRows";

describe("computeWindow", () => {
  it("returns the visible rows plus overscan", () => {
    expect(computeWindow(0, 400, 40, 1000, 2)).toEqual({
      start: 0,
      end: 12,
      offsetTop: 0,
      totalHeight: 40_000,
    });
    expect(computeWindow(4000, 400, 40, 1000, 2)).toEqual({
      start: 98,
      end: 112,
      offsetTop: 3920,
      totalHeight: 40_000,
    });
    expect(computeWindow(39_900, 400, 40, 1000, 2)).toEqual({
      start: 995,
      end: 1000,
      offsetTop: 39_800,
      totalHeight: 40_000,
    });
  });

  it("handles empty lists and a zero viewport", () => {
    expect(computeWindow(0, 0, 40, 0)).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
    expect(computeWindow(0, 0, 40, 10, 4)).toEqual({ start: 0, end: 4, offsetTop: 0, totalHeight: 400 });
  });
});
