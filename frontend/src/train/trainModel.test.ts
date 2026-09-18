import { describe, it, expect } from "vitest";
import { exampleDataset, exampleModel } from "@/test/fixtures";
import {
  DEFAULT_TRAIN_FORM,
  parseEpochMessage,
  suggestName,
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
    expect(parseEpochMessage("epoch 3/50 mAP50 0.612")).toEqual({ epoch: 3, epochs: 50, map50: 0.612 });
    expect(parseEpochMessage("epoch 1/3")).toEqual({ epoch: 1, epochs: 3, map50: null });
    expect(parseEpochMessage("1386 / 3299 images")).toBeNull();
    expect(parseEpochMessage("")).toBeNull();
  });

  it("suggests a name from the dataset and the base model", () => {
    expect(suggestName(exampleDataset, exampleModel)).toBe("v1-yolo11m-coco");
    expect(suggestName(undefined, exampleModel)).toBe("");
  });
});
