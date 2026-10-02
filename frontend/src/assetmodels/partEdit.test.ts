import { describe, expect, it } from "vitest";
import { editNote, numericParams, paramLabel, paramUnit, withParam, withPlacement } from "./partEdit";

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

  it("labels and units agree between the Part tab and the version note", () => {
    expect(paramLabel("id")).toBe("Inside diameter");
    expect(paramLabel("flange_od")).toBe("Flange OD");
    expect(paramLabel("projection")).toBe("Projection");
    expect(paramUnit("dn")).toBe("");
    expect(paramUnit("ratio")).toBe("");
    expect(paramUnit("slope")).toBe("");
    expect(paramUnit("bearing_deg")).toBe("°");
    expect(paramUnit("height")).toBe("mm");
    const shell = { id: "shell" } as never;
    expect(editNote(spec.parts[0] as never, "dn", 80, 100)).toBe("N7: DN 80 → 100");
    expect(editNote(shell, "id", 4000, 4100)).toBe("shell: inside diameter 4000 → 4100 mm");
    expect(editNote(spec.parts[0] as never, "flange_od", 200, 210)).toBe("N7: flange OD 200 → 210 mm");
    expect(editNote(spec.parts[0] as never, "elevation_mm", 7780, 7800)).toBe("N7: elevation 7780 → 7800 mm");
  });
});
