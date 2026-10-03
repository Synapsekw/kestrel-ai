import { describe, expect, it } from "vitest";
import { REASON_TEXT, blockers, matchedByText, missingClasses, normName, prefillClassMap } from "./reviewImport";

const types = [
  { id: "t-crack", name: "Crack" },
  { id: "t-stain", name: "Staining" },
  { id: "t-corr", name: "Corrosion" },
];
const classes = [
  { key: "cracks", label: "Cracks", count: 12, type_id: null },
  { key: "staining", label: "Staining", count: 3, type_id: "t-stain" },
  { key: "spalling", label: "Spalling", count: 1, type_id: null },
] as never;

describe("review import helpers", () => {
  it("normalises names for matching", () => {
    expect(normName("Cracks ")).toBe("crack");
    expect(normName("Paint_Failure")).toBe("paintfailure");
  });

  it("prefills from the server's suggestion, else by name, else nothing", () => {
    expect(prefillClassMap(classes, types)).toEqual({ cracks: "t-crack", staining: "t-stain", spalling: null });
  });

  it("lists classes still without a type", () => {
    expect(missingClasses(classes, { cracks: "t-crack", staining: "t-stain", spalling: null })).toEqual(["spalling"]);
  });

  it("explains unmatched photos and how photos matched", () => {
    expect(REASON_TEXT.not_found).toBe("No image with this name in the image set");
    expect(REASON_TEXT.ambiguous).toBe("More than one image could be this photo");
    expect(matchedByText({ path: 2, time_size: 1 })).toBe("2 by path, 1 by capture time and size");
    expect(matchedByText({})).toBeNull();
  });

  it("names the refusals J5 would fail the real run on", () => {
    const base = { matched: 2, has_glb: false, model: { ready_version: 1, existing_sightings: 0 } } as never;
    expect(blockers(base)).toEqual([]);
    expect(blockers({ ...(base as object), matched: 0 } as never)).toEqual(["No photo in the folder matches an image in this image set."]);
    expect(blockers({ ...(base as object), model: { ready_version: null, existing_sightings: 0 } } as never)).toEqual([
      "The asset model has no 3D model yet and the folder has no model.glb. Import the GLB first.",
    ]);
    expect(blockers({ ...(base as object), model: { ready_version: 1, existing_sightings: 40 } } as never)).toEqual([
      "This asset model already holds 40 sightings. Import into a new asset model instead.",
    ]);
  });
});
