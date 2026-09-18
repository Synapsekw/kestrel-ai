import { describe, it, expect } from "vitest";
import { RESULTS_CSV } from "@/test/fixtures";
import { curvePolyline, parseResultsCsv } from "./resultsCsv";

describe("results.csv", () => {
  it("parses epoch, mAP50 and mAP50-95 columns", () => {
    const points = parseResultsCsv(RESULTS_CSV);
    expect(points).toEqual([
      { epoch: 1, map50: 0.18, map50_95: 0.09 },
      { epoch: 2, map50: 0.45, map50_95: 0.24 },
      { epoch: 3, map50: 0.71, map50_95: 0.44 },
    ]);
  });

  it("tolerates padded headers, skips bad rows and yields nothing for unknown text", () => {
    const padded = "   epoch,   metrics/mAP50(B)\n1, 0.5\nx, y\n2, 0.6\n";
    expect(parseResultsCsv(padded)).toEqual([
      { epoch: 1, map50: 0.5, map50_95: null },
      { epoch: 2, map50: 0.6, map50_95: null },
    ]);
    expect(parseResultsCsv("string")).toEqual([]);
    expect(parseResultsCsv("")).toEqual([]);
  });

  it("maps points into an SVG polyline", () => {
    const points = parseResultsCsv(RESULTS_CSV);
    expect(curvePolyline(points, (p) => p.map50, { width: 100, height: 50, pad: 0 })).toBe(
      "0,41 50,27.5 100,14.5",
    );
    expect(curvePolyline(points, () => null, { width: 100, height: 50, pad: 0 })).toBe("");
    expect(curvePolyline([points[0]], (p) => p.map50, { width: 100, height: 50, pad: 10 })).toBe("10,34.6");
  });
});
