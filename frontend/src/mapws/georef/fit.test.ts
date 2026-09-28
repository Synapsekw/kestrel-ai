import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAffine,
  fitGeoref,
  invertAffine,
  MAX_PAIRS,
  type Affine,
  type FitPair,
  type GeorefModelName,
} from "./fit";

// R-W5-3: M-B3's vectors; backend/tests/test_drawings_georef.py reads the same file (spec §15).
// Preflight (Task 2, deviation c): the fixture has 20 cases, incl. `similarity_near_collinear_accepted`.
const VECTORS = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../contract/fixtures/georef-fit-vectors.json"),
    "utf8",
  ),
) as {
  tolerance: { coef_rel: number; metres: number };
  cases: {
    name: string;
    model: GeorefModelName;
    units_scale: number | null;
    points: FitPair[];
    expect:
      | {
          ok: true;
          transform: number[];
          scale: number;
          rotation_deg?: number;
          rmse_m: number;
          residuals_m: number[];
          warnings: string[];
        }
      | { ok: false; error: string };
  }[];
};
const rel = (got: number, want: number) =>
  Math.abs(got - want) / Math.max(1, Math.abs(want)) <=
  VECTORS.tolerance.coef_rel;
const metres = (got: number, want: number) =>
  Math.abs(got - want) <= VECTORS.tolerance.metres;

describe("fitGeoref agrees with georef.py on the shared vectors", () => {
  it("runs all 20 vectors", () => expect(VECTORS.cases).toHaveLength(20));

  it.each(VECTORS.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = fitGeoref(c.model, c.points, { unitsScale: c.units_scale });
    const want = c.expect;
    if (!want.ok) {
      expect(got).toEqual({ ok: false, error: want.error });
      return;
    }
    if (!got.ok) throw new Error(`refused: ${got.error}`);
    got.transform.forEach((v, i) =>
      expect(rel(v, want.transform[i]), `transform[${i}]`).toBe(true),
    );
    expect(rel(got.scale, want.scale), "scale").toBe(true);
    if (want.rotation_deg !== undefined)
      expect(rel(got.rotation_deg, want.rotation_deg), "rotation").toBe(true);
    expect(metres(got.rmse_m, want.rmse_m), "rmse").toBe(true);
    got.residuals_m.forEach((r, i) =>
      expect(metres(r, want.residuals_m[i]), `residual ${i}`).toBe(true),
    );
    expect(got.warnings).toEqual(want.warnings);
  });

  it("covers every refusal and warning the spec names", () => {
    const errors = new Set(
      VECTORS.cases.flatMap((c) => (c.expect.ok ? [] : [c.expect.error])),
    );
    const warnings = new Set(
      VECTORS.cases.flatMap((c) => (c.expect.ok ? c.expect.warnings : [])),
    );
    expect([...errors].sort()).toEqual([
      "collinear",
      "degenerate",
      "reflection",
      "too_few_points",
      "too_many_points",
    ]);
    expect([...warnings].sort()).toEqual([
      "rmse_high",
      "scale_mismatch",
      "shear",
    ]);
  });
});

describe("fitGeoref (own cases)", () => {
  const T: Affine = [0.02, -0.01, 500000, 0.01, 0.02, 4983000];
  const pairs = (src: [number, number][]): FitPair[] =>
    src.map((s) => ({ src: s, dst: applyAffine(T, s) }));

  it("recovers a similarity from 2 points and an affine from 3, to 1e-9, with RMSE exactly 0 at the minimum", () => {
    const s = fitGeoref(
      "similarity",
      pairs([
        [0, 0],
        [1000, -500],
      ]),
    );
    const a = fitGeoref(
      "affine",
      pairs([
        [0, 0],
        [1000, -500],
        [300, 900],
      ]),
    );
    for (const r of [s, a]) {
      if (!r.ok) throw new Error(r.error);
      r.transform.forEach((v, i) =>
        expect(Math.abs(v - T[i]) / Math.max(1, Math.abs(T[i]))).toBeLessThan(
          1e-9,
        ),
      );
      expect(r.rmse_m).toBe(0);
      expect(r.scale).toBeCloseTo(Math.hypot(0.02, 0.01), 12); // the mean axis length
    }
  });

  it("refuses a similarity whose 3 points are mirrored", () => {
    const mirrored: FitPair[] = [
      { src: [0, 0], dst: [0, 0] },
      { src: [10, 0], dst: [-10, 0] },
      { src: [0, 10], dst: [0, 10] },
    ];
    expect(fitGeoref("similarity", mirrored)).toEqual({
      ok: false,
      error: "reflection",
    });
  });

  it("refuses more than 12 pairs", () => {
    const many = pairs(
      Array.from(
        { length: MAX_PAIRS + 1 },
        (_, i) => [i * 10, (i % 3) * 7] as [number, number],
      ),
    );
    expect(fitGeoref("similarity", many)).toEqual({
      ok: false,
      error: "too_many_points",
    });
  });

  it("inverts an affine, and refuses a singular one", () => {
    const inv = invertAffine(T)!;
    const p = applyAffine(inv, applyAffine(T, [123.4, -567.8]));
    // float64 precision, not 1e-9: T's ~5e6 translation forces ~1e-8 absolute error through the
    // apply/invert round trip (catastrophic cancellation in applyAffine's addition), verified by
    // hand-computing this exact formula; georef.py's identical float64 arithmetic has the same limit.
    expect(p[0]).toBeCloseTo(123.4, 6);
    expect(p[1]).toBeCloseTo(-567.8, 6);
    expect(invertAffine([1, 2, 0, 2, 4, 0])).toBeNull();
  });
});
