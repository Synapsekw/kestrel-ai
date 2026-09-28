import type { ApiClient, CostEstimate, Job, QueryRunCreate, Tiling, components } from "@contract/client";
import { unwrap } from "./errors";

export type QueryRunWithJob = components["schemas"]["QueryRunWithJob"];

/** Spec section 8 defaults; every field is required by the generated client. */
export const DEFAULT_TILING: Tiling = { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 };
export const DEFAULT_CONF = 0.25;

export function estimateQueryRun(
  api: ApiClient,
  projectId: string,
  body: QueryRunCreate,
): Promise<CostEstimate> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/estimate", { params: { path: { projectId } }, body }),
  );
}

export function createQueryRun(
  api: ApiClient,
  projectId: string,
  body: QueryRunCreate,
): Promise<QueryRunWithJob> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs", { params: { path: { projectId } }, body }),
  );
}

/**
 * Re-submit the run's job: persisted tiles are reused, so an interrupted run continues where it
 * stopped. 409 `conflict` while the run's job is still queued or running.
 */
export async function resumeQueryRun(api: ApiClient, projectId: string, runId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/{runId}/resume", {
      params: { path: { projectId, runId } },
    }),
  );
  return r.job;
}
