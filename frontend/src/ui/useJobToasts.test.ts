import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { runningJob } from "@/test/fixtures";
import { useToastStore } from "./toastStore";
import { claimJobOutcome, jobToastText, reportedInline, useJobToasts } from "./useJobToasts";

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

describe("asset review job toasts", () => {
  const done = (
    type: string,
    result: Record<string, unknown> | null = null,
    params: Record<string, unknown> = {},
  ) =>
    ({
      id: "j",
      project_id: "p",
      type,
      state: "succeeded",
      progress: 1,
      message: "",
      log_path: "",
      params,
      result,
      error: null,
      created_at: "",
      started_at: null,
      finished_at: null,
    }) as unknown as Job;

  it("says what each asset job did", () => {
    expect(jobToastText(done("asset_glb_import"))).toBe("GLB imported as a new version");
    expect(jobToastText(done("asset_pose", { estimated: 296, kept: 0, skipped: 3 }))).toBe(
      "Photo poses estimated: 296 photos (3 skipped)",
    );
    expect(jobToastText(done("asset_pose", { estimated: 1, kept: 0, skipped: 0 }))).toBe(
      "Photo poses estimated: 1 photo",
    );
    expect(jobToastText(done("asset_place", { patch: 715, point: 625, none: 101 }))).toBe(
      "Placements computed: 715 patches, 625 pins, 101 not placed",
    );
    expect(jobToastText(done("asset_place"))).toBe("Placements computed");
    expect(jobToastText(done("asset_group", { created: 4, kept: 650, merged: 2, split: 0 }))).toBe(
      "Findings regrouped: 650 kept, 4 new, 2 merged",
    );
    expect(jobToastText(done("asset_group", { created: 656, kept: 0, merged: 0, split: 0 }))).toBe(
      "Findings regrouped: 0 kept, 656 new",
    );
    expect(jobToastText(done("asset_group"))).toBe("Findings regrouped");
    expect(jobToastText(done("review_kit_import"))).toBe("Review job imported");
    expect(
      jobToastText(done("review_kit_import", { findings: 656, sightings: 1441, unmatched_count: 0 })),
    ).toBe("Review job imported: 656 findings from 1441 sightings");
    expect(jobToastText(done("review_kit_import", { photos: 3 }, { dry_run: true }))).toBe(
      "Review folder checked",
    );
  });

  it("names the job when it fails", () => {
    const failed = {
      ...done("asset_place"),
      state: "failed",
      error: "the GLB has no faces",
    } as unknown as Job;
    expect(jobToastText(failed)).toBe("Placement failed: the GLB has no faces");
  });
});

describe("reportedInline", () => {
  it("is true only on the screen that shows the job's outcome", () => {
    expect(reportedInline(base, "/p/p1/images")).toBe(true);
    expect(reportedInline(base, "/p/p1/images/")).toBe(true);
    expect(reportedInline(base, "/models/training")).toBe(false);
    expect(reportedInline({ ...base, type: "train" }, "/models/training")).toBe(true);
    expect(reportedInline({ ...base, type: "train" }, "/p/p1/models/training")).toBe(false);
    expect(reportedInline({ ...base, type: "infer" }, "/p/p1/query")).toBe(true);
    expect(reportedInline({ ...base, type: "export" }, "/models/library")).toBe(false);
    expect(reportedInline(base, "/p/other/images")).toBe(false);
  });

  it("an app screen reports its jobs on its sub-routes too, and the library reports its own jobs", () => {
    const train = { ...base, type: "train" } as Job;
    expect(reportedInline(train, "/models/training/run-1")).toBe(true);
    expect(reportedInline(train, "/models/training/run-1/")).toBe(true);
    expect(reportedInline(train, "/models/trainingx")).toBe(false);
    for (const type of ["library_import", "library_export", "library_starter", "library_adopt"] as const) {
      const job = { ...base, project_id: "library", type } as Job;
      expect(reportedInline(job, "/models/library")).toBe(true);
      expect(reportedInline(job, "/models/training")).toBe(false);
    }
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
    expect(reportedInline({ ...job, type: "import" } as Job, "/p/p1/images/x")).toBe(false);
  });
});

describe("useJobToasts (app-wide)", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useToastStore.getState().clear();
  });
  afterEach(() => useToastStore.getState().clear());

  const libraryTrain: Job = { ...base, id: "j-lib", project_id: "library", type: "train", state: "running" };

  it("toasts a failed library job while no project route is open", () => {
    renderHook(() => useJobToasts({ current: "/models/library" }));
    act(() => useJobsStore.getState().upsert(libraryTrain));
    act(() =>
      useJobsStore.getState().upsert({ ...libraryTrain, state: "failed", error: "CUDA out of memory" }),
    );
    expect(useToastStore.getState().toasts).toMatchObject([
      { tone: "danger", text: "Training failed: CUDA out of memory", action: { label: "Show log" } },
    ]);
  });

  it("toasts a succeeded project job on an app-level route, once", () => {
    renderHook(() => useJobToasts({ current: "/catalogue" }));
    act(() => useJobsStore.getState().upsert({ ...base, state: "running" }));
    act(() =>
      useJobsStore.getState().upsert({ ...base, result: { imported: 40, duplicates: 0, failed: 0 } }),
    );
    act(() => useJobsStore.getState().upsert({ ...base, message: "again" }));
    expect(useToastStore.getState().toasts).toMatchObject([
      { tone: "ok", text: "Import finished: 40 images" },
    ]);
  });

  it("stays quiet on the screen that reports the job inline", () => {
    renderHook(() => useJobToasts({ current: "/p/p1/images" }));
    act(() => useJobsStore.getState().upsert({ ...base, state: "running" }));
    act(() => useJobsStore.getState().upsert(base));
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("'Show log' hands the failed job to openJob", () => {
    const openJob = vi.fn();
    renderHook(() => useJobToasts({ current: "/jobs" }, openJob));
    act(() => useJobsStore.getState().upsert(libraryTrain));
    act(() => useJobsStore.getState().upsert({ ...libraryTrain, state: "failed" }));
    act(() => useToastStore.getState().toasts[0].action?.onClick());
    expect(openJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-lib", state: "failed" }));
  });
});
