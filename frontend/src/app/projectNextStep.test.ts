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
  it("starts by adding photos or a map on Sources", () => {
    expect(projectNextStep("p", "detect", base)).toMatchObject({
      text: "Add photos or a map",
      to: "/p/p/sources",
    });
  });

  it("asks for a library model before a run can start", () => {
    expect(projectNextStep("p", "detect", { ...base, images: 12 })).toMatchObject({
      text: "Add a model to the library",
      to: "/library",
    });
    expect(projectNextStep("p", "detect", { ...base, maps: 1 })).toMatchObject({ to: "/library" });
  });

  it("runs a model once there are sources and a model, photos or a map alike", () => {
    for (const p of [{ images: 12 }, { maps: 1 }]) {
      expect(projectNextStep("p", "detect", { ...base, ...p, models: 1 })).toMatchObject({
        text: "Run a model",
        to: "/p/p/runs",
      });
    }
  });

  it("a map run counts: it moves on to review and the analytics", () => {
    expect(projectNextStep("p", "detect", { ...base, maps: 1, models: 1, hasRuns: true })).toMatchObject({
      text: "Review the detections",
      to: "/p/p/review",
    });
  });

  it("puts waiting detections first and ends on the export", () => {
    expect(
      projectNextStep("p", "detect", { ...base, images: 12, models: 1, queryRuns: 1, pendingReview: 4 }),
    ).toMatchObject({ text: "Review 4 detections", to: "/p/p/review" });
    expect(projectNextStep("p", "detect", { ...base, images: 12, models: 1, queryRuns: 1 })).toMatchObject({
      text: "Export the results",
      to: "/p/p/export",
    });
  });
});
