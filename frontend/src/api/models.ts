import type { ApiClient, Job, Model, TrainRequest, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type Artifact = "results_csv" | "confusion_matrix" | "pr_curve";
export type ModelImport = components["schemas"]["ModelImport"];
export type ExportRequest = components["schemas"]["ExportRequest"];
export type ExportFormat = ExportRequest["format"];

const LIST_LIMIT = 1000;

/** Every registry model, newest first as the backend orders them. */
export function fetchAllModels(api: ApiClient, projectId: string): Promise<Model[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/models", {
        params: {
          path: { projectId },
          query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT },
        },
      }),
    ),
  );
}

export function fetchModel(api: ApiClient, projectId: string, modelId: string): Promise<Model> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/models/{modelId}", { params: { path: { projectId, modelId } } }),
  );
}

export function importModel(api: ApiClient, projectId: string, body: ModelImport): Promise<Model> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/models/import", { params: { path: { projectId } }, body }),
  );
}

/** 202 with the training job; the model row appears when the job succeeds (`job.result.model_id`). */
export async function trainModel(api: ApiClient, projectId: string, body: TrainRequest): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/models/train", { params: { path: { projectId } }, body }),
  );
  return r.job;
}

export async function exportModel(
  api: ApiClient,
  projectId: string,
  modelId: string,
  body: ExportRequest,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/models/{modelId}/export", {
      params: { path: { projectId, modelId } },
      body,
    }),
  );
  return r.job;
}

export async function deleteModel(api: ApiClient, projectId: string, modelId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/models/{modelId}", {
      params: { path: { projectId, modelId } },
    }),
  );
}

/** For `<img src>`: the token goes in the query because images cannot send headers (like `imageFileUrl`). */
export function artifactUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  modelId: string,
  artifact: Artifact,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/models/${modelId}/artifacts/${artifact}?${q}`;
}

/** The raw `results.csv` text; `Accept: text/csv` because the endpoint also serves PNG artifacts. */
export function fetchResultsCsv(api: ApiClient, projectId: string, modelId: string): Promise<string> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/models/{modelId}/artifacts/{artifact}", {
      params: { path: { projectId, modelId, artifact: "results_csv" } },
      parseAs: "text",
      headers: { Accept: "text/csv" },
    }) as Promise<{ data?: string; error?: unknown; response: Response }>,
  );
}
