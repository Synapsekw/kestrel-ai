import type { ApiClient, Job, TrainRequest, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

export type TrainingRun = components["schemas"]["TrainingRun"];

export const TRAINING_RUN_PAGE = 100;

export async function fetchTrainingRuns(api: ApiClient, cursor?: string): Promise<Page<TrainingRun>> {
  const r = await unwrap(
    api.GET("/api/v1/library/training-runs", {
      params: { query: { limit: TRAINING_RUN_PAGE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}

export function fetchTrainingRun(api: ApiClient, runId: string): Promise<TrainingRun> {
  return unwrap(api.GET("/api/v1/library/training-runs/{runId}", { params: { path: { runId } } }));
}

/** 202: the run and its `train` library job; it exports the dataset first when needed (§12.2 step 4). */
export function startTrainingRun(
  api: ApiClient,
  body: TrainRequest,
): Promise<{ training_run: TrainingRun; job: Job }> {
  return unwrap(api.POST("/api/v1/library/training-runs", { body }));
}
