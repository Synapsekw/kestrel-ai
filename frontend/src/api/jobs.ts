import type { ApiClient, Job, JobLog, paths } from "@contract/client";
import { unwrap } from "./errors";

export type ListJobsQuery = NonNullable<
  paths["/api/v1/projects/{projectId}/jobs"]["get"]["parameters"]["query"]
>;

export const JOB_LIST_LIMIT = 100;

/** One page, newest first; the panel shows the last 100 jobs. */
export async function fetchJobs(
  api: ApiClient,
  projectId: string,
  query: ListJobsQuery = {},
): Promise<Job[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/jobs", {
      params: { path: { projectId }, query: { limit: JOB_LIST_LIMIT, ...query } },
    }),
  );
  return r.items;
}

/** Library jobs report `project_id: "library"`; every per-job helper below accepts it as a project id. */
const LIBRARY = "library";

export function fetchJob(api: ApiClient, projectId: string, jobId: string): Promise<Job> {
  if (projectId === LIBRARY)
    return unwrap(api.GET("/api/v1/library/jobs/{jobId}", { params: { path: { jobId } } }));
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/jobs/{jobId}", { params: { path: { projectId, jobId } } }),
  );
}

/** Requests cancellation; the returned job may still be `running` until the worker notices. */
export function cancelJob(api: ApiClient, projectId: string, jobId: string): Promise<Job> {
  if (projectId === LIBRARY)
    return unwrap(api.POST("/api/v1/library/jobs/{jobId}/cancel", { params: { path: { jobId } } }));
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/jobs/{jobId}/cancel", { params: { path: { projectId, jobId } } }),
  );
}

export function fetchJobLog(api: ApiClient, projectId: string, jobId: string, tail = 200): Promise<JobLog> {
  if (projectId === LIBRARY)
    return unwrap(
      api.GET("/api/v1/library/jobs/{jobId}/log", { params: { path: { jobId }, query: { tail } } }),
    );
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/jobs/{jobId}/log", {
      params: { path: { projectId, jobId }, query: { tail } },
    }),
  );
}
