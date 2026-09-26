import type { ApiClient, JobState, components } from "@contract/client";
import { unwrap } from "./errors";

/** A job from any runner: `Job` plus the project's name, null for library jobs (F §10.1). */
export type AppJob = components["schemas"]["AppJob"];

export const APP_JOBS_PAGE = 50;

export interface AppJobQuery {
  state?: JobState[];
  /** A project id, or `library` for library jobs. */
  project_id?: string;
  limit?: number;
  cursor?: string;
}

export interface AppJobPage {
  items: AppJob[];
  next_cursor: string | null;
}

/** One keyset page of `GET /jobs`, newest first. */
export async function fetchAppJobs(api: ApiClient, q: AppJobQuery = {}): Promise<AppJobPage> {
  const r = await unwrap(
    api.GET("/api/v1/jobs", {
      params: {
        query: {
          limit: q.limit ?? APP_JOBS_PAGE,
          ...(q.state && q.state.length > 0 ? { state: q.state } : {}),
          ...(q.project_id ? { project_id: q.project_id } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
        },
      },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}
