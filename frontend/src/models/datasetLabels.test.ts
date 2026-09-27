import { describe, expect, it } from "vitest";
import { exampleLibraryDataset } from "@/test/appSectionFixtures";
import { datasetStateLabel, sourcesText, toSplitAdviceInput } from "./datasetLabels";
import { trainingHref } from "./links";

describe("dataset labels", () => {
  it.each([
    [{ state: "resolving", export_state: "none" }, "Building", true],
    [{ state: "failed", export_state: "none" }, "Failed", false],
    [{ state: "ready", export_state: "none" }, "Ready", false],
    [{ state: "ready", export_state: "building" }, "Exporting", true],
    [{ state: "ready", export_state: "ready" }, "Exported", false],
    [{ state: "ready", export_state: "stale" }, "Export out of date", false],
    [{ state: "ready", export_state: "failed" }, "Export failed", false],
  ] as const)("%o reads %s", (d, text, live) => {
    expect(datasetStateLabel(d)).toMatchObject({ text, live });
  });

  it("names up to three source projects, then counts the rest", () => {
    const src = (name: string) => ({
      ...exampleLibraryDataset.sources[0],
      project_id: name,
      project_name: name,
    });
    expect(sourcesText(exampleLibraryDataset)).toBe("Ahmadia");
    expect(sourcesText({ sources: ["A", "B", "C", "D", "E"].map(src) })).toBe("A, B, C + 2 more");
  });

  it("maps counts onto the split advice input", () => {
    expect(toSplitAdviceInput(exampleLibraryDataset)).toEqual({
      image_count: 30,
      train_count: 24,
      val_count: 6,
      split_method: "by_group",
      split_params: { val_fraction: 0.2 },
    });
  });

  it("links a dataset to a new training run", () => {
    expect(trainingHref()).toBe("/models/training?new=1");
    expect(trainingHref({ datasetId: "d1" })).toBe("/models/training?new=1&dataset=d1");
  });
});
