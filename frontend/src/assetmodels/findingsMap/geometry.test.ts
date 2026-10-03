import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  geometry,
  niceStep,
  normDeg,
  r2,
  type MapDot,
  type MapFrame,
  type MapGeometry,
  type MapReview,
} from "./geometry";

/** P1's shared fixture (spec §9: "a shared fixture pins both"); findings_map.py reads the same file. */
interface Case {
  name: string;
  review: MapReview;
  frame: MapFrame;
  dots: MapDot[];
  expected: MapGeometry;
}

const FIXTURE = resolve(__dirname, "../../../../contract/fixtures/asset-findings-map.json");
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;

describe("findings map geometry parity (contract/fixtures/asset-findings-map.json)", () => {
  it("has the three shared cases", () => {
    expect(CASES.map((c) => c.name)).toEqual([
      "stack_compass_fraction_zones",
      "facade_faces_metre_zones",
      "tower_compass_north_offset",
    ]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s equals the fixture", (_name, c) => {
    expect(JSON.parse(JSON.stringify(geometry(c.review, c.frame, c.dots)))).toEqual(c.expected);
  });
});

describe("findings map helpers", () => {
  it("rounds half up to 0.01", () => {
    expect(r2(0.125)).toBe(0.13);
    expect(r2(-0.006)).toBe(-0.01);
    expect(r2(-0.004)).toBe(0);
    expect(r2(27.315)).toBe(27.32);
  });

  it("wraps degrees into [0, 360) without a negative zero", () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(360)).toBe(0);
    expect(Object.is(normDeg(-0), 0)).toBe(true);
    expect(normDeg(725)).toBe(5);
  });

  it("snaps the height step to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceStep(80)).toBe(10);
    expect(niceStep(42)).toBe(5);
    expect(niceStep(74.4)).toBe(10);
    expect(niceStep(12)).toBe(2);
    expect(niceStep(3)).toBeCloseTo(0.5, 12);
  });

  it("skips a dot without a height or a bearing and counts it as unplaced", () => {
    const review: MapReview = {
      sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], title: "Side" },
      zones: [],
    };
    const frame: MapFrame = {
      height_m: 10,
      north_offset_deg: 0,
      line_azimuth_deg: null,
      silhouette: [],
      levels: [],
    };
    const g = geometry(review, frame, [
      { id: "a", height_m: 5, bearing_deg: null, severity: 1 },
      { id: "b", height_m: null, bearing_deg: 90, severity: 1 },
      { id: "c", height_m: 5, bearing_deg: 90, severity: 1 },
    ]);
    expect(g.dots.map((d) => d.id)).toEqual(["c"]);
    expect(g.unplaced).toBe(2);
  });
});
