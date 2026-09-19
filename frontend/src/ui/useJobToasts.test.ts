import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { jobToastText } from "./useJobToasts";

const base: Job = {
  id: "j1",
  project_id: "p1",
  type: "import",
  state: "succeeded",
  progress: 1,
  message: "",
  log_path: "runs/j1/job.log",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-19T08:00:00Z",
  started_at: "2026-09-19T08:00:01Z",
  finished_at: "2026-09-19T08:01:00Z",
};

describe("jobToastText", () => {
  it("summarises an import from its result", () => {
    expect(jobToastText({ ...base, result: { imported: 40, duplicates: 0, failed: 0 } })).toBe(
      "Import finished: 40 images",
    );
    expect(jobToastText({ ...base, result: { imported: 1, duplicates: 2, failed: 1 } })).toBe(
      "Import finished: 1 image (2 duplicates skipped, 1 failed)",
    );
  });

  it("names the job type on failure and cancellation", () => {
    expect(jobToastText({ ...base, type: "train", state: "failed", error: "out of memory" })).toBe(
      "Training failed: out of memory",
    );
    expect(jobToastText({ ...base, type: "infer", state: "cancelled" })).toBe("Detection cancelled");
  });

  it("counts the boxes of a detection", () => {
    expect(jobToastText({ ...base, type: "infer", result: { query_run_id: "q", boxes: 415 } })).toBe(
      "Detection finished: 415 boxes found",
    );
  });
});
