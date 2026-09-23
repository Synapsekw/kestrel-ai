import type {
  ApiClient,
  Job,
  JobState,
  LibraryModel,
  LibraryModelImport,
  LibraryModelPatch,
  LibraryStatus,
  ModelUsage,
  StarterModelKey,
  TrainRequest,
  components,
} from "@contract/client";
import { codeOf, unwrap } from "./errors";
import { collectPages } from "./paging";

export type { LibraryModel, LibraryModelImport, LibraryModelPatch, LibraryStatus, ModelUsage };
export type Artifact = "results_csv" | "confusion_matrix" | "pr_curve";
export type ExportRequest = components["schemas"]["ExportRequest"];
export type ExportFormat = ExportRequest["format"];
export type ModelTask = LibraryModel["task"];

/** Library jobs carry this in `Job.project_id`; the job helpers in `api/jobs.ts` route on it. */
export const LIBRARY_JOBS = "library";

const LIST_LIMIT = 1000;
const JOB_LIMIT = 100;

/** 503 `library_unavailable`: the app started without its library (spec section 13). Other 503s are not. */
export function isLibraryUnavailable(err: unknown): boolean {
  return codeOf(err) === "library_unavailable";
}

export function fetchLibraryStatus(api: ApiClient): Promise<LibraryStatus> {
  return unwrap(api.GET("/api/v1/library/status"));
}

/** Every library model, newest first as the backend orders them. */
export function fetchLibraryModels(
  api: ApiClient,
  query: { task?: ModelTask } = {},
): Promise<LibraryModel[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/library/models", {
        params: { query: { ...query, limit: LIST_LIMIT, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
}

export function fetchLibraryModel(api: ApiClient, modelId: string): Promise<LibraryModel> {
  return unwrap(api.GET("/api/v1/library/models/{modelId}", { params: { path: { modelId } } }));
}

/** 202 with the import job; the model appears when it succeeds (`job.result.model_id`). */
export async function importLibraryModel(api: ApiClient, body: LibraryModelImport): Promise<Job> {
  const r = await unwrap(api.POST("/api/v1/library/models/import", { body }));
  return r.job;
}

export function updateLibraryModel(
  api: ApiClient,
  modelId: string,
  patch: LibraryModelPatch,
): Promise<LibraryModel> {
  return unwrap(
    api.PATCH("/api/v1/library/models/{modelId}", { params: { path: { modelId } }, body: patch }),
  );
}

export async function deleteLibraryModel(api: ApiClient, modelId: string): Promise<void> {
  await unwrap<unknown>(api.DELETE("/api/v1/library/models/{modelId}", { params: { path: { modelId } } }));
}

/** Which recently opened projects use the model; unknown projects are not scanned. */
export function fetchModelUsage(api: ApiClient, modelId: string): Promise<ModelUsage> {
  return unwrap(api.GET("/api/v1/library/models/{modelId}/usage", { params: { path: { modelId } } }));
}

export async function exportLibraryModel(api: ApiClient, modelId: string, body: ExportRequest): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/library/models/{modelId}/export", { params: { path: { modelId } }, body }),
  );
  return r.job;
}

/** Downloads the starter weights if needed and adds them to the library in a background job. */
export async function acquireStarter(api: ApiClient, key: StarterModelKey, name?: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/library/starters/{key}/acquire", {
      params: { path: { key } },
      body: name ? { name } : {},
    }),
  );
  return r.job;
}

/** One page of library jobs, newest first. */
export async function fetchLibraryJobs(api: ApiClient, query: { state?: JobState } = {}): Promise<Job[]> {
  const r = await unwrap(
    api.GET("/api/v1/library/jobs", { params: { query: { limit: JOB_LIMIT, ...query } } }),
  );
  return r.items;
}

export function fetchLibraryJob(api: ApiClient, jobId: string): Promise<Job> {
  return unwrap(api.GET("/api/v1/library/jobs/{jobId}", { params: { path: { jobId } } }));
}

export function cancelLibraryJob(api: ApiClient, jobId: string): Promise<Job> {
  return unwrap(api.POST("/api/v1/library/jobs/{jobId}/cancel", { params: { path: { jobId } } }));
}

/** For `<img src>`: the token goes in the query because images cannot send headers. */
export function libraryArtifactUrl(
  baseUrl: string,
  token: string,
  modelId: string,
  artifact: Artifact,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/library/models/${modelId}/artifacts/${artifact}?${q}`;
}

/** The raw `results.csv` text; `Accept: text/csv` because the endpoint also serves PNG artifacts. */
export function fetchResultsCsv(api: ApiClient, modelId: string): Promise<string> {
  return unwrap(
    api.GET("/api/v1/library/models/{modelId}/artifacts/{artifact}", {
      params: { path: { modelId, artifact: "results_csv" } },
      parseAs: "text",
      headers: { Accept: "text/csv" },
    }) as Promise<{ data?: string; error?: unknown; response: Response }>,
  );
}

/** 202 with the training job; the trained model is registered in the library when it succeeds. */
export async function trainModel(api: ApiClient, projectId: string, body: TrainRequest): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/train", { params: { path: { projectId } }, body }),
  );
  return r.job;
}
