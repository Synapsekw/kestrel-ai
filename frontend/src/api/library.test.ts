import { describe, it, expect } from "vitest";
import { createApiClient } from "@contract/client";
import {
  errorBody,
  exampleLibraryStatus,
  exampleModel,
  exampleTrainedModel,
  exampleUsage,
  fakeClient,
  MODEL_ID,
  PROJECT_ID,
  RESULTS_CSV,
  runningJob,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import {
  acquireStarter,
  cancelLibraryJob,
  deleteLibraryModel,
  exportLibraryModel,
  fetchLibraryJob,
  fetchLibraryJobs,
  fetchLibraryModel,
  fetchLibraryModels,
  fetchLibraryStatus,
  fetchModelUsage,
  fetchResultsCsv,
  importLibraryModel,
  isLibraryUnavailable,
  libraryArtifactUrl,
  trainModel,
  updateLibraryModel,
} from "./library";

const libraryJob = { ...runningJob, project_id: "library", type: "library_import" as const };

describe("library api", () => {
  it("lists every page of library models, filtered by task", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [exampleTrainedModel], next_cursor: null }
            : { items: [exampleModel], next_cursor: "c2" },
      },
    ]);
    const models = await fetchLibraryModels(api, { task: "detect" });
    expect(models.map((m) => m.id)).toEqual([MODEL_ID, TRAINED_MODEL_ID]);
    expect(requests[0].url).toBe("/api/v1/library/models?task=detect&limit=1000");
    expect(requests[1].url).toBe("/api/v1/library/models?task=detect&limit=1000&cursor=c2");
  });

  it("gets, imports, updates, deletes and reads the usage of a model", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/models\/[^/]+\/usage$/, body: exampleUsage },
      { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleTrainedModel },
      { method: "POST", path: /\/library\/models\/import$/, status: 202, body: { job: libraryJob } },
      {
        method: "PATCH",
        path: /\/library\/models\/[^/]+$/,
        body: { ...exampleTrainedModel, notes: "Weak on trucks." },
      },
      { method: "DELETE", path: /\/library\/models\/[^/]+$/, status: 204 },
    ]);
    expect((await fetchLibraryModel(api, TRAINED_MODEL_ID)).name).toBe("ahmadia-v1-n");
    const job = await importLibraryModel(api, {
      name: "client-x",
      weights_path: "E:/Models/best.pt",
      class_aliases: { truck: "dump_truck" },
      supplier: "Client X",
    });
    expect(job.type).toBe("library_import");
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: "/api/v1/library/models/import",
      body: {
        name: "client-x",
        weights_path: "E:/Models/best.pt",
        class_aliases: { truck: "dump_truck" },
        supplier: "Client X",
      },
    });
    const patched = await updateLibraryModel(api, TRAINED_MODEL_ID, { notes: "Weak on trucks." });
    expect(patched.notes).toBe("Weak on trucks.");
    expect(requests[2]).toMatchObject({
      method: "PATCH",
      url: `/api/v1/library/models/${TRAINED_MODEL_ID}`,
      body: { notes: "Weak on trucks." },
    });
    await deleteLibraryModel(api, TRAINED_MODEL_ID);
    expect(requests[3]).toMatchObject({
      method: "DELETE",
      url: `/api/v1/library/models/${TRAINED_MODEL_ID}`,
    });
    const usage = await fetchModelUsage(api, TRAINED_MODEL_ID);
    expect(usage.projects[0].name).toBe("Ahmadia");
    expect(requests[4].url).toBe(`/api/v1/library/models/${TRAINED_MODEL_ID}/usage`);
  });

  it("starts export, starter and training jobs", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/export$/,
        status: 202,
        body: { job: { ...libraryJob, type: "library_export" } },
      },
      { method: "POST", path: /\/starters\/[^/]+\/acquire$/, status: 202, body: { job: libraryJob } },
      { method: "POST", path: /\/projects\/[^/]+\/train$/, status: 202, body: { job: runningJob } },
    ]);
    const exported = await exportLibraryModel(api, MODEL_ID, { format: "onnx", imgsz: 1280, half: false });
    expect(exported.type).toBe("library_export");
    expect(requests[0]).toMatchObject({
      url: `/api/v1/library/models/${MODEL_ID}/export`,
      body: { format: "onnx", imgsz: 1280, half: false },
    });
    await acquireStarter(api, "yolo11n");
    await acquireStarter(api, "yolo11s", "small-coco");
    expect(requests[1]).toMatchObject({ url: "/api/v1/library/starters/yolo11n/acquire", body: {} });
    expect(requests[2]).toMatchObject({
      url: "/api/v1/library/starters/yolo11s/acquire",
      body: { name: "small-coco" },
    });
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
    expect(requests[3]).toMatchObject({ url: `/api/v1/projects/${PROJECT_ID}/train`, body });
  });

  it("lists, gets and cancels library jobs, and reads the status", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/status$/, body: exampleLibraryStatus },
      { method: "GET", path: /\/library\/jobs$/, body: { items: [libraryJob], next_cursor: null } },
      { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: libraryJob },
      {
        method: "POST",
        path: /\/library\/jobs\/[^/]+\/cancel$/,
        body: { ...libraryJob, state: "cancelled" },
      },
    ]);
    expect((await fetchLibraryStatus(api)).available).toBe(true);
    expect((await fetchLibraryJobs(api, { state: "running" }))[0].id).toBe(libraryJob.id);
    expect(requests[1].url).toBe("/api/v1/library/jobs?limit=100&state=running");
    expect((await fetchLibraryJob(api, libraryJob.id)).type).toBe("library_import");
    expect((await cancelLibraryJob(api, libraryJob.id)).state).toBe("cancelled");
    expect(requests[3]).toMatchObject({
      method: "POST",
      url: `/api/v1/library/jobs/${libraryJob.id}/cancel`,
    });
  });

  it("builds artifact URLs with the token in the query and fetches results.csv as text", async () => {
    expect(libraryArtifactUrl("http://127.0.0.1:4010/", "tok en", MODEL_ID, "pr_curve")).toBe(
      `http://127.0.0.1:4010/api/v1/library/models/${MODEL_ID}/artifacts/pr_curve?token=tok+en`,
    );
    const csvFetch: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      expect(req.headers.get("Accept")).toBe("text/csv");
      expect(req.url).toContain(`/library/models/${TRAINED_MODEL_ID}/artifacts/results_csv`);
      return new Response(RESULTS_CSV, { status: 200, headers: { "Content-Type": "text/csv" } });
    };
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: csvFetch });
    expect(await fetchResultsCsv(api, TRAINED_MODEL_ID)).toBe(RESULTS_CSV);
  });

  it("recognises 503 library_unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        status: 503,
        body: errorBody("library_unavailable", "library.db is corrupt"),
      },
    ]);
    const failure = await fetchLibraryModels(api).catch((e: unknown) => e);
    expect(isLibraryUnavailable(failure)).toBe(true);
    expect(isLibraryUnavailable(new Error("x"))).toBe(false);
  });

  it("does not read an unrelated 503 as the library being unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        status: 503,
        body: errorBody("provider_unavailable", "busy"),
      },
    ]);
    const failure = await fetchLibraryModels(api).catch((e: unknown) => e);
    expect(isLibraryUnavailable(failure)).toBe(false);
  });
});
