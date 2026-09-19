import { describe, it, expect } from "vitest";
import { exampleDataset, exampleModel } from "@/test/fixtures";
import {
  DEFAULT_TRAIN_FORM,
  parseEpochMessage,
  resultAdvice,
  suggestName,
  trainAdvice,
  toTrainRequest,
  validateTrainForm,
} from "./trainModel";

const valid = { ...DEFAULT_TRAIN_FORM, name: "ahmadia-v1-n", datasetId: "d1", baseModelId: "m1" };

describe("train form model", () => {
  it("maps the form to the contract request with auto batch as null", () => {
    expect(toTrainRequest(valid)).toEqual({
      name: "ahmadia-v1-n",
      dataset_id: "d1",
      base_model_id: "m1",
      epochs: 50,
      imgsz: 1280,
      batch: null,
      patience: 50,
      augmentation: "default",
      device: "0",
    });
    expect(
      toTrainRequest({
        ...valid,
        batchAuto: false,
        batch: "8",
        epochs: "3",
        augmentation: "aerial",
        device: "cpu",
      }),
    ).toMatchObject({
      batch: 8,
      epochs: 3,
      augmentation: "aerial",
      device: "cpu",
    });
  });

  it("validates every field", () => {
    expect(validateTrainForm(valid)).toBeNull();
    expect(validateTrainForm({ ...valid, datasetId: "" })).toBe("Choose a dataset.");
    expect(validateTrainForm({ ...valid, baseModelId: "" })).toBe("Choose a base model.");
    expect(validateTrainForm({ ...valid, name: "  " })).toBe("Give the model a name.");
    expect(validateTrainForm({ ...valid, epochs: "0" })).toBe(
      "Epochs must be a whole number from 1 to 1000.",
    );
    expect(validateTrainForm({ ...valid, epochs: "2.5" })).toBe(
      "Epochs must be a whole number from 1 to 1000.",
    );
    expect(validateTrainForm({ ...valid, imgsz: "100" })).toBe(
      "Image size must be a whole number from 320 to 4096.",
    );
    expect(validateTrainForm({ ...valid, batchAuto: false, batch: "" })).toBe(
      "Batch size must be a whole number of at least 1, or automatic.",
    );
    expect(validateTrainForm({ ...valid, batchAuto: true, batch: "" })).toBeNull();
    expect(validateTrainForm({ ...valid, patience: "-1" })).toBe(
      "Patience must be a whole number of at least 0.",
    );
  });

  it("parses the backend's epoch messages", () => {
    expect(parseEpochMessage("epoch 3/50 mAP50 0.612")).toEqual({
      epoch: 3,
      epochs: 50,
      map50: 0.612,
      losses: {},
      etaSeconds: null,
    });
    expect(parseEpochMessage("epoch 1/3")).toEqual({
      epoch: 1,
      epochs: 3,
      map50: null,
      losses: {},
      etaSeconds: null,
    });
  });

  it("parses the loss terms and the ETA the trainer appends", () => {
    expect(parseEpochMessage("epoch 2/10 mAP50 0.500 loss box 1.234 cls 2.346 dfl 1.111 ETA 252s")).toEqual({
      epoch: 2,
      epochs: 10,
      map50: 0.5,
      losses: { box: 1.234, cls: 2.346, dfl: 1.111 },
      etaSeconds: 252,
    });
    expect(parseEpochMessage("epoch 1/3 loss box 0.500 seg 0.250")).toEqual({
      epoch: 1,
      epochs: 3,
      map50: null,
      losses: { box: 0.5, seg: 0.25 },
      etaSeconds: null,
    });
    expect(parseEpochMessage("1386 / 3299 images")).toBeNull();
    expect(parseEpochMessage("")).toBeNull();
  });

  it("suggests a name from the dataset and the base model", () => {
    expect(suggestName(exampleDataset, exampleModel)).toBe("v1-yolo11m-coco");
    expect(suggestName(undefined, exampleModel)).toBe("");
  });
});

describe("trainAdvice", () => {
  const tiny = { ...exampleDataset, image_count: 14, train_count: 8, val_count: 6 };
  const decent = { ...exampleDataset, image_count: 400, train_count: 320, val_count: 80 };

  it("warns before a training on a handful of images", () => {
    expect(trainAdvice(tiny, DEFAULT_TRAIN_FORM)).toContain(
      "Only 8 training images: the model will learn very little. Aim for 200 or more labeled images.",
    );
  });

  it("warns when the validation split is too small to measure anything", () => {
    expect(trainAdvice({ ...decent, val_count: 3 }, DEFAULT_TRAIN_FORM)).toContain(
      "Only 3 validation images: mAP will jump around and say little about the model.",
    );
  });

  it("warns about very few epochs and stays quiet for a sound setup", () => {
    expect(trainAdvice(decent, { ...DEFAULT_TRAIN_FORM, epochs: "3" })).toEqual([
      "3 epochs is a smoke test, not a training. 50 to 100 is usual.",
    ]);
    expect(trainAdvice(decent, DEFAULT_TRAIN_FORM)).toEqual([]);
    expect(trainAdvice(undefined, DEFAULT_TRAIN_FORM)).toEqual([]);
  });
});

describe("resultAdvice", () => {
  it("says plainly when the finished model is unlikely to be useful", () => {
    expect(resultAdvice(0)).toBe(
      "mAP50 is 0.0%: this model will find little or nothing. Label more images, train for more epochs, then compare again.",
    );
    expect(resultAdvice(0.04)).toMatch(/^mAP50 is 4.0%/);
  });

  it("is silent for a usable model or an unknown score", () => {
    expect(resultAdvice(0.45)).toBeNull();
    expect(resultAdvice(null)).toBeNull();
  });
});
