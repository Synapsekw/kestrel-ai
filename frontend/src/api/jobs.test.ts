import { describe, it, expect } from "vitest";
import { errorBody, exampleJobLog, fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { cancelJob, fetchJob, fetchJobLog, fetchJobs } from "./jobs";

describe("jobs api", () => {
  it("lists one page newest first, gets, cancels and tails the log", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob], next_cursor: "string" } },
      { method: "GET", path: /\/jobs\/[^/]+\/log$/, body: exampleJobLog },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob },
      { method: "POST", path: /\/cancel$/, body: { ...runningJob, state: "cancelled" } },
    ]);
    expect((await fetchJobs(api, PROJECT_ID)).map((j) => j.id)).toEqual([JOB_ID]);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs?limit=100`);
    await fetchJobs(api, PROJECT_ID, { state: "running", type: "train" });
    const url = new URL(`http://x${requests[1].url}`);
    expect(url.searchParams.get("state")).toBe("running");
    expect(url.searchParams.get("type")).toBe("train");
    expect((await fetchJob(api, PROJECT_ID, JOB_ID)).progress).toBe(0.42);
    expect((await cancelJob(api, PROJECT_ID, JOB_ID)).state).toBe("cancelled");
    expect(requests[3]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/cancel`,
    });
    const log = await fetchJobLog(api, PROJECT_ID, JOB_ID, 50);
    expect(log.lines).toHaveLength(2);
    expect(requests[4].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/log?tail=50`);
  });

  it("propagates the envelope message on failure", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/jobs\/[^/]+$/,
        status: 404,
        body: errorBody("not_found", "job j1 not found"),
      },
    ]);
    await expect(fetchJob(api, PROJECT_ID, "j1")).rejects.toMatchObject({
      code: "not_found",
      message: "job j1 not found",
    });
  });
});
