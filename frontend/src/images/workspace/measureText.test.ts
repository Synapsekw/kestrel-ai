import { describe, expect, it } from "vitest";
import { basisText, lengthReadout, PX_ONLY } from "./measureText";

const S = { gsdMm: 2, distanceM: 40, sigmaM: 1, source: "lrf" };

describe("measure texts", () => {
  it("names the distance behind every mm", () => {
    expect(basisText(S)).toBe("from GSD 2.0 mm/px at 40.0 m (laser range)");
    expect(basisText({ ...S, source: "rel_alt" })).toContain("nadir approx.");
  });
  it("a length reads mm ± σ with its basis, or px only", () => {
    const t = lengthReadout(100, S);
    expect(t).toMatch(
      /^[\d.,]+\s*(mm|m) ± [\d.,]+\s*(mm|m) · from GSD 2\.0 mm\/px at 40\.0 m \(laser range\)$/,
    );
    expect(lengthReadout(100.4, null)).toBe(`100 px · ${PX_ONLY}`);
  });
});
