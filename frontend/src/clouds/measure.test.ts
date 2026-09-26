import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import {
  FIELDS,
  isGeographic,
  overlayShapes,
  refusal,
  results,
  type MeasureKind,
  type MPoint,
} from "./measure";

const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, "../../../contract/fixtures/cloud-measure-vectors.json"), "utf8"),
) as {
  tolerance: number;
  fields: string[];
  cases: { name: string; kind: MeasureKind; points: MPoint[]; results: Record<string, number> }[];
};

describe("measurement formulas (the same vectors the backend reads)", () => {
  it("lists the fields in contract order", () => {
    expect([...FIELDS]).toEqual(VECTORS.fields);
  });

  it.each(VECTORS.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = results(c.kind, c.points);
    for (const f of FIELDS) {
      const want = c.results[f];
      if (want === undefined) expect(got[f], f).toBeNull();
      else expect(Math.abs((got[f] as number) - want), f).toBeLessThanOrEqual(VECTORS.tolerance);
    }
  });

  it("previews the server's refusals", () => {
    const p = (z: number): MPoint => ({ x: 0, y: 0, z, uncertainty_m: 0 });
    expect(refusal("vertical", [p(0), p(0.3)], false)).toBe(
      "pick points further apart vertically (at least 0.5 m)",
    );
    expect(refusal("vertical", [p(0), p(3)], false)).toBeNull();
    expect(refusal("distance", [p(0), p(3)], true)).toBe(
      "distances need a projected coordinate system; this cloud is in degrees",
    );
    expect(refusal("point", [p(0)], true)).toBeNull();
  });

  it("knows a cloud in degrees", () => {
    expect(isGeographic(exampleCloud)).toBe(false);
    expect(isGeographic({ ...exampleCloud, proj4: "+proj=longlat +datum=WGS84 +no_defs" })).toBe(true);
    expect(isGeographic({ ...exampleCloud, proj4: null })).toBe(false);
    expect(isGeographic({ ...exampleCloud, proj4: "+proj=latlong +datum=WGS84" })).toBe(true);
  });

  it("draws the picks, the segment and the plumb line", () => {
    const a: MPoint = { x: 0, y: 0, z: 0, uncertainty_m: 0 };
    const b: MPoint = { x: 1, y: 0, z: 10, uncertainty_m: 0 };
    expect(overlayShapes("distance", [a, b], null).map((s) => s.kind)).toEqual(["points", "line"]);
    const v = overlayShapes("vertical", [b, a], null);
    expect(v.map((s) => s.kind)).toEqual(["points", "line", "line", "line"]);
    expect(v[2].points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
    ]); // plumb through the lower pick
    expect(v[3].points).toEqual([
      { x: 0, y: 0, z: 10 },
      { x: 1, y: 0, z: 10 },
    ]); // the horizontal offset
    expect(overlayShapes("distance", [a], { ...b }).map((s) => s.kind)).toEqual(["points", "line"]);
  });
});
