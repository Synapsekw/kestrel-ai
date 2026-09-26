import type { ApiClient, Job, components } from "@contract/client";
import { ApiFailure, unwrap } from "./errors";

type S = components["schemas"];
export type RunSummary = S["RunSummary"];
export type RunSummaryPage = S["RunSummaryPage"];
export type RunCreate = S["RunCreate"];
export type RunCreated = S["RunCreated"];
export type ModelClassMap = S["ModelClassMapOut"];
export type ModelClassMapPut = S["ModelClassMapPut"];

export const RUNS_PAGE = 50;

/** One page of runs (photo and map runs together), newest first. */
export function fetchRuns(
  api: ApiClient,
  projectId: string,
  opts: { sourceId?: string; cursor?: string | null; limit?: number } = {},
): Promise<RunSummaryPage> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/runs", {
      params: {
        path: { projectId },
        query: {
          limit: opts.limit ?? RUNS_PAGE,
          ...(opts.sourceId ? { source_id: opts.sourceId } : {}),
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        },
      },
    }),
  );
}

/** 202: one run and one job per source. A `422 unmapped_classes` is read with `unmappedClasses`. */
export function createRuns(api: ApiClient, projectId: string, body: RunCreate): Promise<RunCreated> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/runs", { params: { path: { projectId } }, body }));
}

export function pinRun(
  api: ApiClient,
  projectId: string,
  runId: string,
  pinned: boolean,
): Promise<RunSummary> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/runs/{runId}", {
      params: { path: { projectId, runId } },
      body: { pinned },
    }),
  );
}

export async function recountRun(api: ApiClient, projectId: string, runId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/runs/{runId}/recount", {
      params: { path: { projectId, runId } },
    }),
  );
  return r.job;
}

export function fetchModelClassMap(
  api: ApiClient,
  projectId: string,
  modelId: string,
): Promise<ModelClassMap> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/model-class-maps/{modelId}", {
      params: { path: { projectId, modelId } },
    }),
  );
}

export function saveModelClassMap(
  api: ApiClient,
  projectId: string,
  modelId: string,
  body: ModelClassMapPut,
): Promise<ModelClassMap> {
  return unwrap(
    api.PUT("/api/v1/projects/{projectId}/model-class-maps/{modelId}", {
      params: { path: { projectId, modelId } },
      body,
    }),
  );
}

export interface Unmapped {
  modelId: string;
  unmapped: string[];
}

/** The model classes a `422 unmapped_classes` names, or null for any other failure. */
export function unmappedClasses(err: unknown): Unmapped | null {
  if (!(err instanceof ApiFailure) || err.code !== "unmapped_classes") return null;
  const { model_id, unmapped } = err.details as { model_id?: unknown; unmapped?: unknown };
  if (typeof model_id !== "string" || !Array.isArray(unmapped)) return null;
  return { modelId: model_id, unmapped: unmapped.map(String) };
}
