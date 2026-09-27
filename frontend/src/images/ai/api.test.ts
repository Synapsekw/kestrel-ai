import { describe, expect, it } from "vitest";
import {
  errorBody,
  fakeClient,
  IMAGE_ID,
  MODEL_ID,
  PROJECT_ID,
  exampleJob,
  proposalBox,
} from "@/test/fixtures";
import { ApiFailure } from "@/api/errors";
import {
  acquireAssistModel,
  detectBatch,
  detectImage,
  importAssistModel,
  listAssistModels,
  prepareSegment,
  segment,
} from "./api";

const crop = { x: 0, y: 0, w: 1024, h: 768 };

describe("images/ai api", () => {
  it("runs detect on one image with the model and confidence", async () => {
    const result = {
      model_id: MODEL_ID,
      suggestions: [proposalBox],
      new: 1,
      already_covered: 2,
      device: "cpu",
      elapsed_ms: 900,
    };
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/images\/[^/]+\/detect$/, body: result },
    ]);
    const r = await detectImage(api, PROJECT_ID, IMAGE_ID, { model_id: MODEL_ID, conf: 0.4 });
    expect(r.device).toBe("cpu");
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/images/${IMAGE_ID}/detect`);
    expect(requests[0].body).toEqual({ model_id: MODEL_ID, conf: 0.4 });
  });

  it("queues batch detection and returns the run and its job", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/images\/detect-batch$/,
        status: 202,
        body: { query_run: { id: "q1" }, job: exampleJob },
      },
    ]);
    const r = await detectBatch(api, PROJECT_ID, {
      kind: "local_model",
      model_id: MODEL_ID,
      scope: { image_ids: ["a"] },
    });
    expect(r.job.id).toBe(exampleJob.id);
    expect(requests[0].body).toEqual({
      kind: "local_model",
      model_id: MODEL_ID,
      scope: { image_ids: ["a"] },
    });
  });

  it("prepares and segments with the server's crop and every point", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/segment\/prepare$/,
        body: { crop, device: "cuda", encode_ms: 120, cached: false },
      },
      {
        method: "POST",
        path: /\/segment$/,
        body: { crop, polygon: null, score: 0.1, device: "cuda", encode_ms: 0, decode_ms: 20 },
      },
    ]);
    expect((await prepareSegment(api, PROJECT_ID, IMAGE_ID, crop)).device).toBe("cuda");
    const r = await segment(api, PROJECT_ID, IMAGE_ID, crop, [{ x: 10, y: 20, positive: true }]);
    expect(r.polygon).toBeNull();
    expect(requests[1].body).toEqual({ crop, points: [{ x: 10, y: 20, positive: true }] });
  });

  it("surfaces 409 assist_model_missing with its details", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/segment\/prepare$/,
        status: 409,
        body: errorBody("assist_model_missing", "missing", { key: "sam2.1_t", state: "missing" }),
      },
    ]);
    await expect(prepareSegment(api, PROJECT_ID, IMAGE_ID, crop)).rejects.toMatchObject({
      code: "assist_model_missing",
      details: { key: "sam2.1_t", state: "missing" },
    });
  });

  it("lists, acquires and imports the assist model", async () => {
    const model = {
      key: "sam2.1_t",
      name: "SAM 2.1 tiny",
      description: "",
      size_mb: 78,
      sha256: "0".repeat(64),
      state: "missing",
      reason: null,
      job_id: null,
    };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/assist-models$/, body: { items: [model], next_cursor: null } },
      {
        method: "POST",
        path: /\/assist-models\/sam2\.1_t\/acquire$/,
        status: 202,
        body: { job: exampleJob },
      },
      { method: "POST", path: /\/assist-models\/sam2\.1_t\/import$/, status: 202, body: { job: exampleJob } },
    ]);
    expect((await listAssistModels(api))[0].state).toBe("missing");
    expect((await acquireAssistModel(api, "sam2.1_t")).id).toBe(exampleJob.id);
    await importAssistModel(api, "sam2.1_t", "D:\\offline\\sam2.1_t.pt");
    expect(requests[2].body).toEqual({ path: "D:\\offline\\sam2.1_t.pt" });
  });

  it("throws ApiFailure for a 404 assist list (a build without SAM)", async () => {
    const { api } = fakeClient([]);
    await expect(listAssistModels(api)).rejects.toBeInstanceOf(ApiFailure);
  });
});
