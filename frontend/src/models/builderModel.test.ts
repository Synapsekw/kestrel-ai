import { describe, expect, it } from "vitest";
import {
  emptyBuilderForm,
  MAX_DATASET_TYPES,
  skippedReason,
  toCreateBody,
  toFilter,
  validateBuilder,
} from "./builderModel";

const ready = { ...emptyBuilderForm(["p1"], ["t1"]), name: " machines-v2 " };

describe("dataset builder form", () => {
  it("has no filter until a project and a type are chosen", () => {
    expect(toFilter(emptyBuilderForm([], ["t1"]))).toBeNull();
    expect(toFilter(emptyBuilderForm(["p1"], []))).toBeNull();
    expect(toFilter(ready)).toEqual({
      project_ids: ["p1"],
      type_ids: ["t1"],
      captured_from: null,
      captured_to: null,
      reviewed_only: true,
      boxes_as_polygons: false,
    });
  });

  it("validates name, projects, types, dates and split", () => {
    expect(validateBuilder({ ...ready, name: " " })).toBe("Give the dataset a name.");
    expect(validateBuilder({ ...ready, projectIds: [] })).toBe("Choose at least one project.");
    expect(validateBuilder({ ...ready, typeIds: [] })).toBe("Choose at least one type.");
    expect(validateBuilder({ ...ready, from: "2026-05-02", to: "2026-05-01" })).toBe(
      "The start date is after the end date.",
    );
    expect(validateBuilder({ ...ready, valFraction: "0.9" })).toBe(
      "Validation fraction must be between 0.05 and 0.5.",
    );
    expect(validateBuilder({ ...ready, seed: "1.5" })).toBe("Seed must be a whole number.");
    expect(validateBuilder(ready)).toBeNull();
  });

  it("refuses more types than a dataset can hold (DatasetFilter.type_ids maxItems 200)", () => {
    expect(MAX_DATASET_TYPES).toBe(200);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(validateBuilder({ ...ready, typeIds: ids(200) })).toBeNull();
    expect(validateBuilder({ ...ready, typeIds: ids(201) })).toBe(
      "A dataset holds at most 200 types; 201 are chosen.",
    );
  });

  it("builds the create body", () => {
    expect(toCreateBody({ ...ready, from: "2026-04-01" })).toEqual({
      name: "machines-v2",
      task: "detect",
      filter: {
        project_ids: ["p1"],
        type_ids: ["t1"],
        captured_from: "2026-04-01",
        captured_to: null,
        reviewed_only: true,
        boxes_as_polygons: false,
      },
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
  });

  it("sends boxes_as_polygons with the filter", () => {
    const f = { ...emptyBuilderForm(["p"], ["t"]), task: "segment" as const, boxesAsPolygons: true };
    expect(toFilter(f)).toMatchObject({ boxes_as_polygons: true });
    expect(toFilter(emptyBuilderForm(["p"], ["t"]))).toMatchObject({ boxes_as_polygons: false });
  });

  it("explains what a task skips", () => {
    expect(skippedReason("segment", false)).toBe("they hold boxes or point markers of the chosen types");
    expect(skippedReason("segment", true)).toBe("they hold point markers of the chosen types");
    expect(skippedReason("detect", false)).toBe("they hold point markers of the chosen types");
  });
});
