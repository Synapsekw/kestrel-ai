import { describe, it, expect } from "vitest";
import { createApiClient } from "@contract/client";
import {
  errorBody,
  exampleModel,
  exampleTrainedModel,
  fakeClient,
  MODEL_ID,
  PROJECT_ID,
  RESULTS_CSV,
  runningJob,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import {
  artifactUrl,
  deleteModel,
  exportModel,
  fetchAllModels,
  fetchModel,
  fetchResultsCsv,
  importModel,
  trainModel,
} from "./models";

describe("models api", () => {
  it("lists every page, gets one model and imports weights with aliases", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/models$/,
        body: { items: [exampleModel, exampleTrainedModel], next_cursor: null },
      },
      { method: "GET", path: /\/models\/[^/]+$/, body: exampleTrainedModel },
      { method: "POST", path: /\/models\/import$/, status: 201, body: exampleModel },
    ]);
    const models = await fetchAllModels(api, PROJECT_ID);
    expect(models.map((m) => m.id)).toEqual([MODEL_ID, TRAINED_MODEL_ID]);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/models?limit=1000`);
    expect((await fetchModel(api, PROJECT_ID, TRAINED_MODEL_ID)).name).toBe("ahmadia-v1-n");
    const imported = await importModel(api, PROJECT_ID, {
      name: "yolo11m-coco",
      weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
      class_aliases: { truck: "dump_truck" },
    });
    expect(imported.id).toBe(MODEL_ID);
    expect(requests[2]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/models/import`,
      body: {
        name: "yolo11m-coco",
        weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
        class_aliases: { truck: "dump_truck" },
      },
    });
  });

  it("starts training and export jobs, deletes a model", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/models\/train$/, status: 202, body: { job: runningJob } },
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, type: "export" } } },
      { method: "DELETE", path: /\/models\/[^/]+$/, status: 204 },
    ]);
    const body = {
      name: "ahmadia-v1-n",
      dataset_id: "d",
      base_model_id: MODEL_ID,
      epochs: 3,
      imgsz: 1280,
      batch: null,
      patience: 50,
      augmentation: "aerial" as const,
      device: "0",
    };
    expect((await trainModel(api, PROJECT_ID, body)).id).toBe(runningJob.id);
    expect(requests[0].body).toEqual(body);
    const job = await exportModel(api, PROJECT_ID, MODEL_ID, { format: "onnx", imgsz: 1280, half: false });
    expect(job.type).toBe("export");
    expect(requests[1]).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}/export`,
      body: { format: "onnx", imgsz: 1280, half: false },
    });
    await deleteModel(api, PROJECT_ID, MODEL_ID);
    expect(requests[2]).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}`,
    });
  });

  it("builds artifact URLs with the token in the query and fetches results.csv as text", async () => {
    expect(artifactUrl("http://127.0.0.1:4010/", "tok en", PROJECT_ID, MODEL_ID, "pr_curve")).toBe(
      `http://127.0.0.1:4010/api/v1/projects/${PROJECT_ID}/models/${MODEL_ID}/artifacts/pr_curve?token=tok+en`,
    );
    const csvFetch: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      expect(req.headers.get("Accept")).toBe("text/csv");
      expect(req.url).toContain(`/models/${TRAINED_MODEL_ID}/artifacts/results_csv`);
      return new Response(RESULTS_CSV, { status: 200, headers: { "Content-Type": "text/csv" } });
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: csvFetch });
    expect(await fetchResultsCsv(api, PROJECT_ID, TRAINED_MODEL_ID)).toBe(RESULTS_CSV);
  });

  it("surfaces 501 as ApiFailure with code not_implemented", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/models$/,
        status: 501,
        body: errorBody("not_implemented", "models arrive with S3"),
      },
    ]);
    await expect(fetchAllModels(api, PROJECT_ID)).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
  });
});
