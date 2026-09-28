import { afterEach, describe, expect, it } from "vitest";
import { exampleGeoMap } from "@/test/fixtures";
import { ApiFailure } from "@/api/errors";
import {
  NO_SOURCE,
  extentRing,
  readLastModel,
  regionBody,
  regionError,
  regionMaps,
  regionProblem,
  regionSourceId,
  writeLastModel,
} from "./regionRun";

const sep = { ...exampleGeoMap, id: "sep", captured_on: "2026-09-14" };
const ring = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
];

describe("AI detect in a region", () => {
  afterEach(() => localStorage.clear());

  it("turns the dragged box into an open ring", () => {
    expect(extentRing([0, 0, 5, 5])).toEqual(ring);
  });

  it("builds a region run on the map's source", () => {
    expect(
      regionBody({
        sourceId: "s1",
        mapId: "sep",
        ring,
        modelId: "m1",
        conf: 0.3,
        gsdCm: 2,
      }),
    ).toEqual({
      source_ids: ["s1"],
      model_id: "m1",
      conf: 0.3,
      target_gsd_cm: 2,
      region: { map_id: "sep", polygon_site: ring },
    });
  });

  it("refuses before any request when no ortho of r is there or the model has no scale", () => {
    expect(regionProblem({ maps: [], r: "2026-09-14", model: { train_gsd_cm: 2 } })).toBe(
      "AI detect needs an orthomosaic of 14 Sep 2026 under the box.",
    );
    expect(regionProblem({ maps: [sep], r: "2026-09-14", model: null })).toBe("Choose a model.");
    expect(
      regionProblem({
        maps: [sep],
        r: "2026-09-14",
        model: { train_gsd_cm: null },
      }),
    ).toMatch(/Set the scale this model was trained at/);
    expect(
      regionProblem({
        maps: [sep],
        r: "2026-09-14",
        model: { train_gsd_cm: 2 },
      }),
    ).toBeNull();
    expect(
      regionMaps([sep, { ...sep, id: "aug", captured_on: "2026-08-14" }], "2026-09-14").map((m) => m.id),
    ).toEqual(["sep"]);
  });

  it("dates an undated map by its import day and puts the newest import first", () => {
    const undated = { ...sep, id: "undated", captured_on: null, created_at: "2026-09-14T12:00:00Z" };
    const older = { ...sep, id: "older", created_at: "2026-09-10T08:00:00Z" };
    const local = { ...sep, id: "local", crs_wkt: null };
    const importing = { ...sep, id: "importing", status: "importing" as const };
    expect(regionMaps([older, local, undated, importing], "2026-09-14").map((m) => m.id)).toEqual([
      "undated",
      "older",
    ]);
    expect(regionMaps([sep], null)).toEqual([]);
  });

  it("finds the map's detection source, and never falls back to the map id", () => {
    const src = { id: "s1", map_id: "sep" };
    expect(regionSourceId([src, { id: "s2", map_id: null }], "sep")).toBe("s1");
    expect(regionSourceId([{ id: "s2", map_id: null }], "sep")).toBeNull();
    expect(NO_SOURCE).toMatch(/no detection source/);
  });

  it("explains an empty region and unmapped classes", () => {
    expect(regionError(new ApiFailure("empty_region", "x", 422))).toBe(
      "Nothing to scan in this box: it has no map pixels under it. Draw the box over the orthomosaic.",
    );
    expect(
      regionError(
        new ApiFailure("unmapped_classes", "x", 422, {
          model_id: "m",
          unmapped: ["a"],
        }),
      ),
    ).toMatch(/Map them once in Run detection/);
  });

  it("remembers the last model", () => {
    writeLastModel("m9");
    expect(readLastModel()).toBe("m9");
  });
});
