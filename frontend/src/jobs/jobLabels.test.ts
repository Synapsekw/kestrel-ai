import { describe, it, expect } from "vitest";
import { runningJob } from "@/test/fixtures";
import {
  elapsedSeconds,
  formatDuration,
  jobTitle,
  resultsExportFiles,
  resultsExportFolder,
  resultsExportSummary,
  resultTarget,
  stateLabel,
} from "./jobLabels";

describe("job labels", () => {
  it("titles jobs by type and name", () => {
    expect(jobTitle(runningJob)).toBe("Import");
    expect(jobTitle({ ...runningJob, type: "train", params: { name: "ahmadia-v1-n" } })).toBe(
      "Training: ahmadia-v1-n",
    );
    expect(jobTitle({ ...runningJob, type: "infer" })).toBe("Detection run");
    expect(stateLabel("cancelled")).toBe("Cancelled");
  });

  it("computes elapsed time from started_at to now or finished_at", () => {
    const now = Date.parse("2026-09-17T10:06:31Z");
    expect(elapsedSeconds(runningJob, now)).toBe(90);
    expect(elapsedSeconds({ ...runningJob, finished_at: "2026-09-17T10:05:43Z" }, now)).toBe(42);
    expect(elapsedSeconds({ ...runningJob, started_at: null }, now)).toBeNull();
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(185)).toBe("3 min 05 s");
    expect(formatDuration(3720)).toBe("1 h 02 min");
  });

  it("links a finished job to what it produced", () => {
    expect(resultTarget(runningJob, "p")).toBeNull();
    expect(
      resultTarget({ ...runningJob, type: "train", state: "succeeded", result: { model_id: "m9" } }, "p"),
    ).toEqual({
      label: "Open model",
      to: "/p/p/models?model=m9",
    });
    expect(
      resultTarget(
        { ...runningJob, type: "infer", state: "succeeded", result: { query_run_id: "q1", boxes: 3 } },
        "p",
      ),
    ).toEqual({ label: "Open run", to: "/p/p/query?run=q1" });
    expect(
      resultTarget(
        {
          ...runningJob,
          type: "export",
          state: "succeeded",
          params: { model_id: "m1", format: "onnx" },
          result: { format: "onnx", path: "models/x.onnx" },
        },
        "p",
      ),
    ).toEqual({ label: "Open model", to: "/p/p/models?model=m1" });
    expect(
      resultTarget({ ...runningJob, type: "dataset", state: "succeeded", result: { dataset_id: "d1" } }, "p"),
    ).toEqual({
      label: "Train on it",
      to: "/p/p/train",
    });
    expect(resultTarget({ ...runningJob, type: "train", state: "succeeded", result: null }, "p")).toBeNull();
    expect(
      resultTarget(
        { ...runningJob, type: "results_export", state: "succeeded", result: { folder: "exports/x" } },
        "p",
      ),
    ).toBeNull();
    expect(
      resultTarget({ ...runningJob, type: "map_import", state: "succeeded", result: { map_id: "m1" } }, "p"),
    ).toEqual({ label: "Open maps", to: "/p/p/maps" });
    // A map export's files live in the Export screen's job list (widened to include map exports),
    // not on the Maps screen that started it.
    expect(
      resultTarget(
        { ...runningJob, type: "map_export", state: "succeeded", result: { folder: "exports/x" } },
        "p",
      ),
    ).toEqual({ label: "Open export", to: "/p/p/export" });
  });

  it("titles a results export and summarises its result", () => {
    expect(jobTitle({ ...runningJob, type: "results_export" })).toBe("Results export");
    const succeeded = {
      ...runningJob,
      type: "results_export" as const,
      state: "succeeded" as const,
      result: {
        folder: "exports/2026-09-19_101500",
        files: ["detections.csv", "report.html"],
        image_count: 12,
        box_count: 30,
      },
    };
    expect(resultsExportSummary(succeeded)).toBe("12 images, 30 boxes");
    expect(resultsExportFiles(succeeded)).toEqual(["detections.csv", "report.html"]);
    expect(resultsExportFolder(succeeded)).toBe("exports/2026-09-19_101500");
    expect(resultsExportSummary({ ...succeeded, state: "running" })).toBeNull();
    expect(resultsExportSummary({ ...runningJob, type: "train" })).toBeNull();
  });

  it("opens a finished map export's folder the same way as a results export", () => {
    const succeeded = {
      ...runningJob,
      type: "map_export" as const,
      state: "succeeded" as const,
      result: {
        folder: "exports/2026-09-22_120000",
        files: ["map-a-labels.csv"],
        box_count: 1,
      },
    };
    expect(resultsExportFolder(succeeded)).toBe("exports/2026-09-22_120000");
    expect(resultsExportFiles(succeeded)).toEqual(["map-a-labels.csv"]);
    // a map export has no images, so the image-count summary stays unavailable for it
    expect(resultsExportSummary(succeeded)).toBeNull();
  });
});

it("links a downloaded starter to the model and labels it clearly", () => {
  const job = {
    ...runningJob,
    params: { purpose: "starter_model", key: "yolo26n" },
    state: "succeeded" as const,
    result: { model_id: "m1" },
  };
  expect(jobTitle(job)).toBe("Model download: yolo26n");
  expect(resultTarget(job, "p")).toEqual({ label: "Open model", to: "/p/p/models?model=m1" });
});
