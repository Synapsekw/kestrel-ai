import { describe, it, expect } from "vitest";
import { nextStep } from "./nextStep";

const base = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
};

describe("nextStep", () => {
  it("walks a new project through import, labeling, dataset, a base model, training and detection", () => {
    expect(nextStep("p", base)).toMatchObject({ text: "Import images", to: "/p/p/data" });
    expect(nextStep("p", { ...base, images: 40 })).toMatchObject({
      text: "Label your images",
      detail: "Open an image and draw boxes around the machinery. 0 of 40 are labeled.",
      to: "/p/p/label",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 30 })).toMatchObject({
      text: "Keep labeling",
      detail:
        "30 of 400 labeled. A first useful model needs about 200; you can also create a dataset now and try a training.",
      to: "/p/p/label",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250 })).toMatchObject({
      text: "Create a dataset",
      to: "/p/p/datasets",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1 })).toMatchObject({
      text: "Add a starter model",
      to: "/p/p/models",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1, models: 1 })).toMatchObject({
      text: "Train a model",
      to: "/p/p/train",
    });
    expect(
      nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1, models: 2, trainedModels: 1 }),
    ).toMatchObject({ text: "Run detection on 150 unlabeled images", to: "/p/p/query" });
  });

  it("puts waiting suggestions first once there are any", () => {
    expect(
      nextStep("p", {
        ...base,
        images: 400,
        labeled: 250,
        datasets: 1,
        models: 2,
        trainedModels: 1,
        pendingReview: 37,
      }),
    ).toMatchObject({ text: "Review 37 suggestions", to: "/p/p/review" });
    expect(nextStep("p", { ...base, images: 4, pendingReview: 1 })?.text).toBe("Review 1 suggestion");
  });

  it("has nothing to push when everything is labeled and reviewed", () => {
    expect(
      nextStep("p", { ...base, images: 10, labeled: 10, datasets: 1, models: 2, trainedModels: 1 }),
    ).toBeNull();
  });
});
