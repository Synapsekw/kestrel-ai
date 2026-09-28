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
import { createQueryRun, DEFAULT_TILING, estimateQueryRun, resumeQueryRun } from "./queryRuns";

describe("query runs api", () => {
  it("estimates and creates", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/query-runs\/estimate$/, body: exampleEstimate },
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: exampleQueryRun, job: runningJob },
      },
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
  });

  it("resumes an interrupted run and surfaces the 409 conflict", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/resume$/,
        status: 202,
        body: { job: { ...runningJob, type: "infer" } },
      },
    ]);
    const job = await resumeQueryRun(api, PROJECT_ID, RUN_ID);
    expect(job.id).toBe(runningJob.id);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/query-runs/${RUN_ID}/resume`,
      body: null,
    });

    const busy = fakeClient([
      {
        method: "POST",
        path: /\/resume$/,
        status: 409,
        body: errorBody("conflict", "the run's job is still running"),
      },
    ]);
    await expect(resumeQueryRun(busy.api, PROJECT_ID, RUN_ID)).rejects.toMatchObject({
      code: "conflict",
      status: 409,
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
