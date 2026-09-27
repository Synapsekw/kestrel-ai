import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import type { CloudMeasurementParams } from "@contract/client";
import {
  ALL_FIELDS,
  AREA_FIELDS,
  FIELDS,
  MeasureRefusal,
  areaResults,
  areaVertices,
  isGeographic,
  isNonCoplanar,
  overlayShapes,
  refusal,
  results,
  type AllResults,
  type GPoint,
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

/** C-B1's new top-level vector keys (plan 2026-09-27-clouds-b1.md Ruling 1). */
type CCase = {
  name: string;
  params?: CloudMeasurementParams | null;
  points: GPoint[];
  results: Record<string, number>;
};
type CRefusal = {
  name: string;
  kind: "area" | "vertical";
  params: CloudMeasurementParams | null;
  points: GPoint[];
  code: string;
};
type CVectors = {
  tolerance: number;
  area_fields: string[];
  area_cases: CCase[];
  ring_fields: string[];
  ring_cases: CCase[];
  refusal_cases: CRefusal[];
};
/** X1's local copy of those keys (plan 2026-09-27-clouds-x1.md Ruling 3). C-M1 deletes the file and this
 * constant, and keeps only the shared set, once C-B1 is on main. */
const LOCAL_C = JSON.parse(
  readFileSync(resolve(__dirname, "../test/cloud-measure-vectors-c.json"), "utf8"),
) as CVectors;
const SHARED_C = VECTORS as unknown as Partial<CVectors>;
const C_SETS: [string, CVectors][] = [
  ["X1 copy", LOCAL_C],
  ...(SHARED_C.area_cases ? [["shared", SHARED_C as CVectors] as [string, CVectors]] : []),
];

/** Every one of the 32 result fields: the listed ones within tolerance, all others null. */
function expectResults(
  got: AllResults,
  want: Record<string, number>,
  fields: readonly string[],
  tol: number,
) {
  for (const f of ALL_FIELDS) {
    const w = fields.includes(f) ? want[f] : undefined;
    if (w === undefined) expect(got[f], f).toBeNull();
    else expect(Math.abs((got[f] as number) - w), f).toBeLessThanOrEqual(tol);
  }
}

function refusedWith(fn: () => unknown): MeasureRefusal {
  try {
    fn();
  } catch (e) {
    if (e instanceof MeasureRefusal) return e;
    throw e;
  }
  throw new Error("expected a MeasureRefusal");
}

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

describe.each(C_SETS)("area vectors (%s), the same as measure.py", (_set, V) => {
  it("names the area fields in contract order", () => {
    expect([...AREA_FIELDS]).toEqual(V.area_fields);
  });

  it.each(V.area_cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expectResults(areaResults(c.points, c.params ?? null), c.results, V.area_fields, V.tolerance);
  });

  it.each(V.refusal_cases.filter((c) => c.kind === "area").map((c) => [c.name, c] as const))(
    "refuses %s",
    (_n, c) => {
      const r = refusedWith(() => areaResults(c.points, c.params));
      expect(r.code).toBe(c.code);
      expect(r.message).not.toBe("");
    },
  );
});

describe("area edge cases (C-B1's pytest, mirrored)", () => {
  const p = (x: number, y: number, z: number, u = 0.01): MPoint => ({ x, y, z, uncertainty_m: u });

  it("meets success criterion 3: a 2 x 1.5 m patch tilted 60 degrees at any bearing", () => {
    const b = (30 * Math.PI) / 180;
    const s = [Math.sin(b), Math.cos(b), 0];
    const d = [Math.cos(b), -Math.sin(b), 0];
    const w = [0, 1, 2].map(
      (i) => 1.5 * (Math.cos(Math.PI / 3) * d[i] + Math.sin(Math.PI / 3) * [0, 0, 1][i]),
    );
    const o = [243500.3, 3178000.7, 12.0];
    const at = (k: number[]) => p(o[0] + k[0], o[1] + k[1], o[2] + k[2]);
    const pts = [at([0, 0, 0]), at(s.map((v) => 2 * v)), at(s.map((v, i) => 2 * v + w[i])), at(w)];
    const r = areaResults(pts, null);
    expect(r.area_surface_m2!).toBeCloseTo(3.0, 6);
    expect(r.area_plan_m2!).toBeCloseTo(1.5, 6);
    expect(r.area_m2).toBe(r.area_surface_m2);
    expect(r.plane_tilt_deg!).toBeCloseTo(60.0, 6);
    expect(r.plane_azimuth_deg!).toBeCloseTo(300.0, 6);
    expect(areaResults(pts, { mode: "plan" }).area_m2).toBe(r.area_plan_m2);
  });

  it("drops the closing vertex however often it repeats", () => {
    const a = p(0, 0, 0);
    const b = p(1, 0, 0);
    const c = p(1, 1, 0);
    expect(areaVertices([a, b, c, { ...a }, { ...a }])).toEqual([a, b, c]);
    expect(areaVertices([a, b, c])).toEqual([a, b, c]);
  });

  it("falls back to the upward normal for a zero view direction", () => {
    const pts = [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0.5), p(1, 0, 0.5)]; // clockwise: Newell points down
    expect(areaResults(pts, null).plane_azimuth_deg).toBeCloseTo(270, 12);
    expect(areaResults(pts, { view_dir: [0, 0, 0] }).plane_azimuth_deg).toBeCloseTo(270, 12);
  });

  it.each([1e200, 1e308])("refuses huge coordinates instead of answering NaN (%s)", (big) => {
    const pts = [p(big, big, 0), p(-big, big, 0), p(-big, -big, 0), p(big, -big, 1)];
    expect(refusedWith(() => areaResults(pts, null)).code).toBe("degenerate_polygon");
  });

  it("leaves every S1 and ring field null for an area, and notes non-coplanar vertices", () => {
    const r = areaResults([p(0, 0, 0), p(1, 0, 0), p(1, 1, 0)], null);
    for (const f of FIELDS) expect(r[f], f).toBeNull();
    expect(r.ring_radius_lower_m).toBeNull();
    expect(r.area_m2!).toBeCloseTo(0.5, 12);
    expect(isNonCoplanar({ plane_rms_m: 0.04, area_surface_m2: 1 })).toBe(false);
    expect(isNonCoplanar({ plane_rms_m: 0.06, area_surface_m2: 1 })).toBe(true);
    expect(isNonCoplanar({ plane_rms_m: 0.2, area_surface_m2: 25 })).toBe(false); // 0.05 x 5 = 0.25
    expect(isNonCoplanar({ plane_rms_m: null, area_surface_m2: null })).toBe(false);
  });
});
