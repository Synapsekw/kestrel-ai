import { describe, expect, it } from "vitest";
import {
  PROFILE_BOX,
  cutFillPaths,
  exaggerationLabel,
  nearestStation,
  niceStep,
  profileScales,
  seriesPath,
} from "./profileScales";

const box = PROFILE_BOX; // 300 × 170, plot 252 × 134
const stations = [0, 10, 20, 30, 40, 50];
const moves = (d: string) => (d.match(/M/g) ?? []).length;

describe("profileScales", () => {
  it("maps chainage to x and height to y inside the plot", () => {
    const sc = profileScales([0, 100], [[0, 10]], box)!;
    expect(sc.x(0)).toBe(box.left);
    expect(sc.x(100)).toBe(box.w - box.right);
    expect(sc.y(sc.zHi)).toBe(box.top);
    expect(sc.y(sc.zLo)).toBe(box.h - box.bottom);
    expect(sc.zLo).toBeLessThanOrEqual(0);
    expect(sc.zHi).toBeGreaterThanOrEqual(10);
  });

  it("reports the vertical exaggeration of the plot", () => {
    const sc = profileScales([0, 100], [[0, 10]], box)!;
    const plotW = box.w - box.left - box.right;
    const plotH = box.h - box.top - box.bottom;
    expect(sc.exaggeration).toBeCloseTo(plotH / (sc.zHi - sc.zLo) / (plotW / 100), 9);
    expect(exaggerationLabel(5.317)).toBe("V.E. ×5.3");
    expect(exaggerationLabel(12.4)).toBe("V.E. ×12");
  });

  it("a flat profile still has a height range (no division by zero)", () => {
    const sc = profileScales(stations, [[600, 600, 600, 600, 600, 600]], box)!;
    expect(sc.zHi).toBeGreaterThan(sc.zLo);
    expect(Number.isFinite(sc.y(600))).toBe(true);
  });

  it("no finite height → no scales (the chart shows its empty state)", () => {
    expect(profileScales(stations, [[null, null, null, null, null, null]], box)).toBeNull();
    expect(profileScales([], [[]], box)).toBeNull();
  });

  it("ticks are nice steps covering the range", () => {
    expect(niceStep(10, 4)).toBe(5);
    expect(niceStep(0.9, 4)).toBe(0.5);
    const sc = profileScales(stations, [[598.1, 601, 624.8, 610, 605, 600]], box)!;
    expect(sc.ticks[0]).toBe(sc.zLo);
    expect(sc.ticks[sc.ticks.length - 1]).toBe(sc.zHi);
  });

  it("a gap splits the line (NaN and null are breaks, never zero)", () => {
    const sc = profileScales(stations, [[1, 2, null, 4, 5, 6]], box)!;
    const d = seriesPath(stations, [1, 2, null, 4, 5, 6], sc);
    expect(moves(d)).toBe(2);
    expect(moves(seriesPath(stations, [1, 2, Number.NaN, 4, 5, 6], sc))).toBe(2);
    expect(d).not.toContain("NaN");
  });

  it("shades fill where the compared series is above the reference, cut below", () => {
    const ref = [0, 0, 0, 0, 0, 0];
    const sc = profileScales(stations, [ref, [1, 1, 1, 1, 1, 1]], box)!;
    const above = cutFillPaths(stations, ref, [1, 1, 1, 1, 1, 1], sc);
    expect(above.fill).not.toBe("");
    expect(above.cut).toBe("");
    const crossing = cutFillPaths(stations, ref, [1, -1, 1, -1, 1, -1], sc);
    expect(crossing.fill).not.toBe("");
    expect(crossing.cut).not.toBe("");
    expect(cutFillPaths(stations, ref, [1, null, null, null, null, null], sc)).toEqual({ cut: "", fill: "" });
  });

  it("finds the nearest station", () => {
    expect(nearestStation(stations, 23)).toBe(2);
    expect(nearestStation(stations, 999)).toBe(5);
    expect(nearestStation(stations, -5)).toBe(0);
  });
});
