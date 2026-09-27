import { describe, expect, it } from "vitest";
import { datasetBuilderHref, readBuilderPreset } from "./links";

describe("dataset builder links (plan decision 9)", () => {
  it("builds the builder URL with optional presets", () => {
    expect(datasetBuilderHref()).toBe("/models/datasets?new=1");
    expect(datasetBuilderHref({ projectIds: ["p1"], typeIds: ["t1", "t2"] })).toBe(
      "/models/datasets?new=1&project=p1&types=t1%2Ct2",
    );
  });

  it("opens on ?new=1 or on ?project= alone (SH's /p/:id/datasets redirect)", () => {
    expect(readBuilderPreset(new URLSearchParams(""))).toEqual({ open: false, projectIds: [], typeIds: [] });
    expect(readBuilderPreset(new URLSearchParams("project=p1"))).toEqual({
      open: true,
      projectIds: ["p1"],
      typeIds: [],
    });
    expect(readBuilderPreset(new URLSearchParams("new=1&types=t1,t2"))).toEqual({
      open: true,
      projectIds: [],
      typeIds: ["t1", "t2"],
    });
  });
});
