import { describe, it, expect } from "vitest";
import {
  errorBody,
  exampleEstimate,
  exampleQueryRun,
  fakeClient,
  IMAGE_ID,
  PROJECT_ID,
  RUN_ID,
  runningJob,
} from "@/test/fixtures";
import {
  createQueryRun,
  DEFAULT_TILING,
  estimateQueryRun,
  fetchQueryRun,
  fetchQueryRuns,
  promoteQueryRun,
} from "./queryRuns";

describe("query runs api", () => {
  it("estimates, creates, lists, gets and promotes", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/query-runs\/estimate$/, body: exampleEstimate },
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: exampleQueryRun, job: runningJob },
      },
      { method: "GET", path: /\/query-runs$/, body: { items: [exampleQueryRun], next_cursor: null } },
      {
        method: "POST",
        path: /\/promote$/,
        body: { query_run: { ...exampleQueryRun, promoted_at: "2026-09-17T13:30:00Z" }, accepted: 6 },
      },
      { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
    ]);
    const body = {
      kind: "cloud_provider" as const,
      provider: "anthropic" as const,
      query: "dump trucks",
      image_ids: [IMAGE_ID],
      tiling: DEFAULT_TILING,
      conf: 0.25,
    };
    expect((await estimateQueryRun(api, PROJECT_ID, body)).estimated_cost).toBe(0.8);
    expect(requests[0]).toMatchObject({ url: `/api/v1/projects/${PROJECT_ID}/query-runs/estimate`, body });
    const created = await createQueryRun(api, PROJECT_ID, body);
    expect(created.query_run.id).toBe(RUN_ID);
    expect(created.job.id).toBe(runningJob.id);
    expect(requests[1].body).toEqual(body);
    expect((await fetchQueryRuns(api, PROJECT_ID)).map((r) => r.id)).toEqual([RUN_ID]);
    expect((await fetchQueryRun(api, PROJECT_ID, RUN_ID)).query).toBe("dump trucks");
    const promoted = await promoteQueryRun(api, PROJECT_ID, RUN_ID, 0.5);
    expect(promoted.accepted).toBe(6);
    expect(requests[4]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/promote`,
      body: { min_confidence: 0.5 },
    });
  });

  it("surfaces 501 until S4 lands", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/estimate$/,
        status: 501,
        body: errorBody("not_implemented", "query runs arrive with S4"),
      },
    ]);
    await expect(
      estimateQueryRun(api, PROJECT_ID, { kind: "local_model", model_id: "m", image_ids: ["a"], conf: 0.25 }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });
});
