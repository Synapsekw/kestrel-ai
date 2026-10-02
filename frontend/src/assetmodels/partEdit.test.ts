import { describe, expect, it } from "vitest";
import { editNote, numericParams, withParam, withPlacement } from "./partEdit";

const spec = {
  parts: [
    {
      id: "N7",
      name: "N7",
      group: "Nozzle",
      shape: "nozzle",
      params: { dn: 80, od: 88.9, projection: 200, flange_od: 200, flange_t: 20, blind: false },
      placement: { host: "shell", bearing_deg: 270, elevation_mm: 7780 },
      source: { kind: "drawing", id: "d" },
    },
  ],
};

describe("part edits", () => {
  it("lists numeric params only, in order", () => {
    expect(numericParams(spec.parts[0] as never).map((p) => p.key)).toEqual([
      "dn",
      "od",
      "projection",
      "flange_od",
      "flange_t",
    ]);
  });

  it("edits immutably", () => {
    const next = withParam(spec as never, "N7", "projection", 250);
    expect(next.parts![0].params.projection).toBe(250);
    expect(spec.parts[0].params.projection).toBe(200);
    expect(withPlacement(spec as never, "N7", "bearing_deg", 90).parts![0].placement!.bearing_deg).toBe(90);
  });

  it("writes a readable version note", () => {
    expect(editNote(spec.parts[0] as never, "projection", 200, 250)).toBe("N7: projection 200 → 250 mm");
    expect(editNote(spec.parts[0] as never, "bearing_deg", 270, 90)).toBe("N7: bearing 270 → 90°");
  });
});
