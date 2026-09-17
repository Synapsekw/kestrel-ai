import { describe, it, expect, beforeEach } from "vitest";
import type { Job } from "@contract/client";
import { useJobsStore } from "./jobs";

const job = {
  id: "j1",
  project_id: "p",
  type: "import",
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
    useJobsStore.setState({ jobs: {} });
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
    s.applyEvent({
      type: "job.state",
      project_id: "p",
      job_id: "j1",
      progress: 1,
      message: "",
      payload: { state: "succeeded" },
    });
    expect(useJobsStore.getState().jobs.j1.state).toBe("succeeded");
    expect(useJobsStore.getState().active()).toEqual([]);
  });

  it("ignores events for unknown jobs", () => {
    useJobsStore.getState().applyEvent({
      type: "job.progress",
      project_id: "p",
      job_id: "missing",
      progress: 0.5,
      message: "half",
      payload: {},
    });
    expect(useJobsStore.getState().jobs).toEqual({});
  });
});
