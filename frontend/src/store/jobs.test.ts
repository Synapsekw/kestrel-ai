import { describe, it, expect, beforeEach } from "vitest";
import type { Job } from "@contract/client";
import { isActiveJob, selectActiveCount, useJobsStore } from "./jobs";

const job = {
  id: "j1",
  project_id: "p",
  type: "train",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "runs/j1/job.log",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-17T00:00:00Z",
  started_at: null,
  finished_at: null,
} satisfies Job;

describe("jobs store", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
  });

  it("applies progress and state events", () => {
    const s = useJobsStore.getState();
    s.upsert(job);
    s.applyEvent({
      type: "job.progress",
      project_id: "p",
      job_id: "j1",
      progress: 0.5,
      message: "half",
      payload: {},
    });
    expect(useJobsStore.getState().jobs.j1.progress).toBe(0.5);
    expect(useJobsStore.getState().jobs.j1.message).toBe("half");
    expect(
      useJobsStore
        .getState()
        .active()
        .map((j) => j.id),
    ).toEqual(["j1"]);
    expect(selectActiveCount(useJobsStore.getState())).toBe(1);
    s.applyEvent(
      {
        type: "job.state",
        project_id: "p",
        job_id: "j1",
        progress: null,
        message: "",
        payload: { state: "succeeded", result: { model_id: "m9" }, error: null },
      },
      "2026-09-17T00:10:00Z",
    );
    const done = useJobsStore.getState().jobs.j1;
    expect(done.state).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(done.result).toEqual({ model_id: "m9" });
    expect(done.finished_at).toBe("2026-09-17T00:10:00Z");
    expect(isActiveJob(done)).toBe(false);
    expect(useJobsStore.getState().active()).toEqual([]);
  });

  it("keeps a failed job's error and does not overwrite an existing finished_at", () => {
    useJobsStore.getState().upsert({ ...job, state: "running", finished_at: null });
    useJobsStore.getState().applyEvent(
      {
        type: "job.state",
        project_id: "p",
        job_id: "j1",
        progress: 0.3,
        message: "",
        payload: { state: "failed", error: "boom" },
      },
      "2026-09-17T00:05:00Z",
    );
    const failed = useJobsStore.getState().jobs.j1;
    expect(failed).toMatchObject({
      state: "failed",
      error: "boom",
      progress: 0.3,
      finished_at: "2026-09-17T00:05:00Z",
    });
    useJobsStore.getState().applyEvent(
      {
        type: "job.state",
        project_id: "p",
        job_id: "j1",
        progress: null,
        message: "",
        payload: { state: "failed" },
      },
      "2026-09-17T00:06:00Z",
    );
    expect(useJobsStore.getState().jobs.j1.finished_at).toBe("2026-09-17T00:05:00Z");
  });

  it("ignores events for unknown jobs, merges lists and toggles the panel", () => {
    useJobsStore.getState().applyEvent({
      type: "job.progress",
      project_id: "p",
      job_id: "missing",
      progress: 0.5,
      message: "half",
      payload: {},
    });
    expect(useJobsStore.getState().jobs).toEqual({});
    useJobsStore.getState().upsertMany([job, { ...job, id: "j2" }]);
    useJobsStore.getState().upsertMany([{ ...job, id: "j2", state: "running" }]);
    expect(Object.keys(useJobsStore.getState().jobs).sort()).toEqual(["j1", "j2"]);
    expect(useJobsStore.getState().jobs.j2.state).toBe("running");
    useJobsStore.getState().setPanelOpen(true);
    expect(useJobsStore.getState().panelOpen).toBe(true);
  });
});
