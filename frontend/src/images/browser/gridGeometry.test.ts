import { describe, expect, it } from "vitest";
import { stemOf } from "./format";
import { GRID_FALLBACK_WIDTH, gridGeometry, scrollTargetFor, visibleRange } from "./gridGeometry";

describe("grid geometry (spec §7.2)", () => {
  it("row height is (width − gutters)/3 · 3/4 + gap", () => {
    const g = gridGeometry(256);
    expect(g.cols).toBe(3);
    expect(g.cellW).toBeCloseTo((256 - 14) / 3);
    expect(g.cellH).toBeCloseTo(((256 - 14) / 3) * 0.75);
    expect(g.rowH).toBeCloseTo(g.cellH + 7);
    expect(gridGeometry(0)).toEqual(gridGeometry(GRID_FALLBACK_WIDTH));
  });

  it("scrolls only when the thumb is out of view, smoothly under 3 rows", () => {
    const rowH = 60;
    expect(scrollTargetFor(4, rowH, 3, 0, 300)).toBeNull(); // row 1, visible
    expect(scrollTargetFor(18, rowH, 3, 0, 300)).toEqual({ top: 120, smooth: true }); // row 6, just below
    expect(scrollTargetFor(300, rowH, 3, 0, 300)).toEqual({ top: 5760, smooth: false }); // row 100
    expect(scrollTargetFor(0, rowH, 3, 600, 300)).toEqual({ top: 0, smooth: false });
  });

  it("captions the visible range", () => {
    expect(visibleRange(0, 300, 60, 3, 312)).toEqual({ from: 1, to: 15 });
    expect(visibleRange(60 * 100, 300, 60, 3, 312)).toEqual({ from: 301, to: 312 });
    expect(visibleRange(0, 300, 60, 3, 0)).toEqual({ from: 0, to: 0 });
  });

  it("stems a file name", () => {
    expect(stemOf("DJI_0212.JPG")).toBe("DJI_0212");
    expect(stemOf("noext")).toBe("noext");
    expect(stemOf("a.b.tif")).toBe("a.b");
  });
});
