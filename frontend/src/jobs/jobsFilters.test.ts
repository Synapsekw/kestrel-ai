import { describe, expect, it } from "vitest";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { inSegment, jobUrl, jobsViewParams, mergeJobs, projectLabel, readJobsView } from "./jobsFilters";

describe("jobs view <-> URL", () => {
  it("defaults to Running with no project and no open job", () => {
    expect(readJobsView(new URLSearchParams(""))).toEqual({ segment: "running", project: null, jobId: null });
  });

  it("reads state, project and job, and ignores an unknown state", () => {
    expect(readJobsView(new URLSearchParams("state=failed&project=library&job=j1"))).toEqual({
      segment: "failed",
      project: "library",
      jobId: "j1",
    });
    expect(readJobsView(new URLSearchParams("state=toString")).segment).toBe("running");
  });

  it("writes only what differs from the defaults", () => {
    expect(jobsViewParams({ segment: "running", project: null, jobId: null }).toString()).toBe("");
    expect(jobsViewParams({ segment: "finished", project: "p1", jobId: "j1" }).toString()).toBe(
      "state=finished&project=p1&job=j1",
    );
  });
});

describe("segments", () => {
  it("puts succeeded and cancelled under Finished", () => {
    expect(inSegment("finished", "succeeded")).toBe(true);
    expect(inSegment("finished", "cancelled")).toBe(true);
    expect(inSegment("finished", "failed")).toBe(false);
    expect(inSegment("running", "queued")).toBe(false);
  });
});

describe("jobUrl", () => {
  it("opens the job in the segment that lists it", () => {
    expect(jobUrl({ id: "j1", state: "running" })).toBe("/jobs?job=j1");
    expect(jobUrl({ id: "j1", state: "queued" })).toBe("/jobs?state=queued&job=j1");
    expect(jobUrl({ id: "j1", state: "failed" })).toBe("/jobs?state=failed&job=j1");
    expect(jobUrl({ id: "j1", state: "succeeded" })).toBe("/jobs?state=finished&job=j1");
    expect(jobUrl({ id: "j1", state: "cancelled" })).toBe("/jobs?state=finished&job=j1");
  });
});

describe("mergeJobs", () => {
  it("lets the newer copy win and keeps newest first", () => {
    const [a, b, c] = exampleAppJobs;
    const merged = mergeJobs([b, c], [{ ...b, progress: 1 }, a]);
    expect(merged.map((j) => j.id)).toEqual([a.id, b.id, c.id]);
    expect(merged[1].progress).toBe(1);
  });
});

describe("projectLabel", () => {
  it("names library jobs and falls back when the name is unknown", () => {
    expect(projectLabel(exampleAppJobs[0])).toBe("Ahmadia");
    expect(projectLabel(exampleAppJobs[1])).toBe("Model library");
    expect(projectLabel({ ...exampleAppJobs[0], project_name: null })).toBe("Project");
  });
});
