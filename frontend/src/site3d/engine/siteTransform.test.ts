import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  plantToScene,
  plantToSite,
  sceneToSite,
  siteToPlant,
  siteToScene,
  type SiteFrameT,
} from "./siteTransform";

/** F0's golden vectors (index "Golden vectors"); siteframe.py reads the same file. */
interface Vectors {
  frame: {
    crs: { epsg: number | null; wkt?: string | null };
    origin_crs: [number, number];
    plant_north_deg: number;
    datum?: { label: string; el_m: number };
  };
  rows: { plant_E: number; plant_N: number; site_X: number; site_Y: number }[];
}

const V = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../contract/fixtures/plant-grid-vectors.json"), "utf8"),
) as Vectors;

const FRAME: SiteFrameT = {
  crs: { epsg: V.frame.crs.epsg ?? null, wkt: V.frame.crs.wkt ?? null },
  origin_crs: V.frame.origin_crs,
  plant_north_deg: V.frame.plant_north_deg,
  datum: V.frame.datum ?? { label: "HPFS", el_m: 100 },
};

describe("siteTransform (pinned to contract/fixtures/plant-grid-vectors.json)", () => {
  it("has at least 50 golden rows", () => {
    expect(V.rows.length).toBeGreaterThanOrEqual(50);
  });

  it("plant -> site reproduces the register within 0.05 m", () => {
    for (const r of V.rows) {
      const [x, y] = plantToSite(FRAME, r.plant_E, r.plant_N);
      expect(Math.abs(x - r.site_X)).toBeLessThan(0.05);
      expect(Math.abs(y - r.site_Y)).toBeLessThan(0.05);
    }
  });

  it("site -> plant inverts plant -> site", () => {
    for (const r of V.rows) {
      const [e, n] = siteToPlant(FRAME, ...plantToSite(FRAME, r.plant_E, r.plant_N));
      expect(e).toBeCloseTo(r.plant_E, 6);
      expect(n).toBeCloseTo(r.plant_N, 6);
    }
  });

  it("scene is x = N, y = EL - datum, z = E", () => {
    expect(plantToScene(FRAME, 1300, 450, 141)).toEqual([450, 141 - FRAME.datum.el_m, 1300]);
  });

  it("site -> scene -> site round-trips", () => {
    const r = V.rows[0];
    const s = siteToScene(FRAME, r.site_X, r.site_Y, 112.5);
    const [x, y, z] = sceneToSite(FRAME, ...s);
    expect(x).toBeCloseTo(r.site_X, 6);
    expect(y).toBeCloseTo(r.site_Y, 6);
    expect(z).toBeCloseTo(112.5, 9);
  });

  it("a frame rotated 90° puts plant north on site east", () => {
    const f: SiteFrameT = { ...FRAME, origin_crs: [1000, 2000], plant_north_deg: 90 };
    const [x, y] = plantToSite(f, 0, 10);
    expect(x).toBeCloseTo(1010, 9);
    expect(y).toBeCloseTo(2000, 9);
  });
});
