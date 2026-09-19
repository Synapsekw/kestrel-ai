import { describe, it, expect } from "vitest";
import { nextStep } from "./nextStep";

const base = { images: 0, labeled: 0, pendingReview: 0, datasets: 0, models: 0, trainedModels: 0 };

describe("nextStep", () => {
  it("walks a new project through import, a base model, labeling, dataset, training and running", () => {
    expect(nextStep("p", base)).toMatchObject({ text: "Import a folder of images.", to: "/p/p/data" });
    expect(nextStep("p", { ...base, images: 40 })).toMatchObject({
      text: "Label images: open one from the list (Enter or double-click) and draw boxes. 0 of 40 are labeled.",
      to: "/p/p/data",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 30 })).toMatchObject({
      text: "Keep labeling (30 of 400 labeled; a first useful model needs about 200), or freeze a dataset and try a training.",
      to: "/p/p/datasets",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250 })).toMatchObject({
      text: "Freeze the 250 labeled images into a dataset.",
      to: "/p/p/datasets",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1 })).toMatchObject({
      text: "Add a starter model: training needs one as its base.",
      to: "/p/p/models",
    });
    expect(nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1, models: 1 })).toMatchObject({
      text: "Train a model on the dataset.",
      to: "/p/p/train",
    });
    expect(
      nextStep("p", { ...base, images: 400, labeled: 250, datasets: 1, models: 2, trainedModels: 1 }),
    ).toMatchObject({ text: "Run the trained model over the 150 unlabeled images.", to: "/p/p/query" });
  });

  it("puts waiting proposals first once there are any", () => {
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
    ).toMatchObject({ text: "Review the 37 proposals waiting in the queue.", to: "/p/p/review" });
  });

  it("has nothing to push when everything is labeled and reviewed", () => {
    expect(
      nextStep("p", { ...base, images: 10, labeled: 10, datasets: 1, models: 2, trainedModels: 1 }),
    ).toBeNull();
  });
});
