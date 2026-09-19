import type {
  ApiClient,
  CostEstimate,
  Job,
  QueryRun,
  QueryRunCreate,
  Tiling,
  components,
} from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type QueryRunWithJob = components["schemas"]["QueryRunWithJob"];
export type PromoteResult = components["schemas"]["PromoteResult"];
export type UnpromoteResult = components["schemas"]["UnpromoteResult"];

/** Spec section 8 defaults; every field is required by the generated client. */
export const DEFAULT_TILING: Tiling = { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 };
export const DEFAULT_CONF = 0.25;

const LIST_LIMIT = 1000;

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

export function fetchQueryRuns(api: ApiClient, projectId: string): Promise<QueryRun[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/query-runs", {
        params: {
          path: { projectId },
          query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT },
        },
      }),
    ),
  );
}

export function fetchQueryRun(api: ApiClient, projectId: string, runId: string): Promise<QueryRun> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/query-runs/{runId}", { params: { path: { projectId, runId } } }),
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

/**
 * Accept the run's unreviewed boxes at or above `minConfidence` (a state change, not a copy).
 * With `dryRun` nothing changes and `accepted` is the number a real call would accept.
 */
export function promoteQueryRun(
  api: ApiClient,
  projectId: string,
  runId: string,
  minConfidence: number,
  dryRun = false,
): Promise<PromoteResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/{runId}/promote", {
      params: { path: { projectId, runId } },
      body: { min_confidence: minConfidence, dry_run: dryRun },
    }),
  );
}

/** Undo a promotion: the boxes it accepted return to unreviewed; a person's reviews are kept. */
export function unpromoteQueryRun(
  api: ApiClient,
  projectId: string,
  runId: string,
): Promise<UnpromoteResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs/{runId}/unpromote", {
      params: { path: { projectId, runId } },
    }),
  );
}
