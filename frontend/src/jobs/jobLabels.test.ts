import { describe, it, expect } from "vitest";
import { runningJob } from "@/test/fixtures";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";

describe("job labels", () => {
  it("titles jobs by type and name", () => {
    expect(jobTitle(runningJob)).toBe("Import");
    expect(jobTitle({ ...runningJob, type: "train", params: { name: "ahmadia-v1-n" } })).toBe(
      "Training: ahmadia-v1-n",
    );
    expect(jobTitle({ ...runningJob, type: "infer" })).toBe("Query run");
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
  });
});
