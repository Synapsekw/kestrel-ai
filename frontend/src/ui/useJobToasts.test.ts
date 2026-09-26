import { describe, expect, it } from "vitest";
import type { Job } from "@contract/client";
import { runningJob } from "@/test/fixtures";
import { claimJobOutcome, jobToastText, reportedInline } from "./useJobToasts";

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

describe("reportedInline", () => {
  it("is true only on the screen that shows the job's outcome", () => {
    expect(reportedInline(base, "/p/p1/data")).toBe(true);
    expect(reportedInline(base, "/p/p1/data/")).toBe(true);
    expect(reportedInline(base, "/p/p1/train")).toBe(false);
    expect(reportedInline({ ...base, type: "train" }, "/p/p1/train")).toBe(true);
    expect(reportedInline({ ...base, type: "infer" }, "/p/p1/query")).toBe(true);
    expect(reportedInline({ ...base, type: "export" }, "/library")).toBe(false);
    expect(reportedInline(base, "/p/other/data")).toBe(false);
  });

  it("a LAZ export is quiet only while a mounted watcher claims it, on any screen", () => {
    const job = { ...runningJob, type: "pointcloud_export", project_id: "p1", state: "succeeded" } as Job;
    // Unclaimed (the Clouds screen was left and opened again before F1): the global toast shows.
    expect(reportedInline(job, "/p/p1/clouds")).toBe(false);
    expect(reportedInline(job, "/p/p1/clouds/c-123")).toBe(false);
    const release = claimJobOutcome(job.id);
    expect(reportedInline(job, "/p/p1/clouds/c-123")).toBe(true);
    expect(reportedInline(job, "/p/p1/maps/m-1")).toBe(true);
    const again = claimJobOutcome(job.id);
    release();
    release(); // idempotent
    expect(reportedInline(job, "/p/p1/clouds")).toBe(true);
    again();
    expect(reportedInline(job, "/p/p1/clouds")).toBe(false);
    expect(reportedInline({ ...job, type: "import" } as Job, "/p/p1/data/x")).toBe(false);
  });
});
