// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  colourSpread,
  coverageCounts,
  frameStats,
  insideClipBox,
  percentileOf,
  pinGrid,
  pngSize,
  profileTotals,
} from "../../scripts/cloud-perf-lib.mjs";

describe("cloud-perf-lib (C-G drivers)", () => {
  it("takes percentiles the way F's probe does", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileOf(sorted, 0.5)).toBe(50);
    expect(percentileOf(sorted, 0.95)).toBe(95);
    expect(percentileOf([], 0.95)).toBe(0);
    expect(frameStats([16.7, 16.7, 33.4, 16.71])).toEqual({ samples: 4, p50: 16.7, p95: 33.4, max: 33.4 });
  });

  it("sums a function's total time from a CPU profile, counting recursion once", () => {
    // 10 samples over 1 ms: 100 µs each. root(1) -> pins(2, 3 hits) -> pins(3, 2 hits) -> leaf(4, 1 hit)
    const profile = {
      startTime: 0,
      endTime: 1000,
      samples: new Array(10).fill(1),
      timeDeltas: new Array(10).fill(100),
      nodes: [
        { id: 1, callFrame: { functionName: "(root)" }, hitCount: 4, children: [2] },
        { id: 2, callFrame: { functionName: "projectPins" }, hitCount: 3, children: [3] },
        { id: 3, callFrame: { functionName: "projectPins" }, hitCount: 2, children: [4] },
        { id: 4, callFrame: { functionName: "leaf" }, hitCount: 1 },
      ],
    };
    const t = profileTotals(profile, ["projectPins", "leaf", "absent"]);
    expect(t.projectPins).toBeCloseTo(0.6, 6); // (3 + 2 + 1) hits x 0.1 ms
    expect(t.leaf).toBeCloseTo(0.1, 6);
    expect(t.absent).toBe(0);
  });

  it("spreads n pins over the inner 80 % of the cloud's footprint", () => {
    const pins = pinGrid([100, 200, 0, 200, 300, 10], 200);
    expect(pins).toHaveLength(200);
    for (const [x, y] of pins) {
      expect(x).toBeGreaterThanOrEqual(110);
      expect(x).toBeLessThanOrEqual(190);
      expect(y).toBeGreaterThanOrEqual(210);
      expect(y).toBeLessThanOrEqual(290);
    }
    expect(new Set(pins.map((p) => p.join())).size).toBe(200);
  });

  it("tests a point against a clip box rotated about Z", () => {
    const box = { centre: [10, 10, 5], size: [4, 2, 10], yaw_deg: 90 };
    expect(insideClipBox([10, 11.9, 5], box)).toBe(true); // the 4 m side now runs north-south
    expect(insideClipBox([11.9, 10, 5], box)).toBe(false); // the 2 m side east-west
    expect(insideClipBox([10, 10, 10.001], box, 0.01)).toBe(true);
    expect(insideClipBox([10, 10, 10.1], box, 0.01)).toBe(false);
  });

  it("reads a PNG's IHDR size and refuses other bytes", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40,
      0, 0, 0x03, 0xe8,
    ]);
    expect(pngSize(png)).toEqual({ width: 1600, height: 1000 });
    expect(pngSize(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("counts distinct colours and the share that is not the backdrop", () => {
    expect(colourSpread([7, 7, 7, 7])).toEqual({ distinct: 1, nonBackground: 0 });
    expect(colourSpread([7, 7, 9, 12])).toEqual({ distinct: 3, nonBackground: 0.5 });
  });

  it("sums call counts of named functions across scripts from precise coverage", () => {
    const coverage = {
      result: [
        { functions: [{ functionName: "pickAtClient", ranges: [{ count: 12 }, { count: 3 }] }] },
        {
          functions: [
            { functionName: "pickAtClient", ranges: [{ count: 5 }] },
            { functionName: "x", ranges: [{ count: 9 }] },
          ],
        },
      ],
    };
    // the first range is the whole function; inner ranges are blocks and are not calls
    expect(coverageCounts(coverage, ["pickAtClient", "absent"])).toEqual({ pickAtClient: 17, absent: 0 });
  });
});
