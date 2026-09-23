import { describe, expect, it } from "vitest";
import type { ProjectProgress } from "./nextStep";
import { projectNextStep } from "./projectNextStep";

const base: ProjectProgress = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
  maps: 0,
};

describe("projectNextStep, training project", () => {
  it("follows the training steps", () => {
    expect(projectNextStep("p", "train", base)).toMatchObject({ text: "Import images", to: "/p/p/data" });
    expect(projectNextStep("p", "train", { ...base, images: 400, labeled: 250 })).toMatchObject({
      text: "Create a dataset",
    });
  });

  it("never sends a training project to detection: after training it asks for more labels", () => {
    const step = projectNextStep("p", "train", {
      ...base,
      images: 400,
      labeled: 250,
      datasets: 1,
      models: 2,
      trainedModels: 1,
    });
    expect(step).toMatchObject({ text: "Label 150 more images", to: "/p/p/label" });
  });
});

describe("projectNextStep, detection project", () => {
  it("starts by adding images or a map", () => {
    expect(projectNextStep("p", "detect", base)).toMatchObject({
      text: "Add images or a map",
      to: "/p/p/data",
    });
  });

  it("asks for a library model before a detection can run", () => {
    expect(projectNextStep("p", "detect", { ...base, images: 12 })).toMatchObject({
      text: "Add a model to the library",
      to: "/library",
    });
    expect(projectNextStep("p", "detect", { ...base, maps: 1 })).toMatchObject({ to: "/library" });
  });

  it("runs a detection once there are images and a model", () => {
    expect(projectNextStep("p", "detect", { ...base, images: 12, models: 1 })).toMatchObject({
      text: "Run a detection",
      to: "/p/p/query",
    });
  });

  it("with only a map, a detection is started on the map", () => {
    expect(projectNextStep("p", "detect", { ...base, maps: 1, models: 1 })).toMatchObject({
      text: "Run a detection on your map",
      to: "/p/p/maps",
    });
  });

  it("puts waiting suggestions first and ends on the export", () => {
    expect(
      projectNextStep("p", "detect", { ...base, images: 12, models: 1, queryRuns: 1, pendingReview: 4 }),
    ).toMatchObject({ text: "Review 4 suggestions", to: "/p/p/review" });
    expect(projectNextStep("p", "detect", { ...base, images: 12, models: 1, queryRuns: 1 })).toMatchObject({
      text: "Export the results",
      to: "/p/p/export",
    });
  });
});
