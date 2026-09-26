import type { JobState } from "@contract/client";
import type { AppJob } from "@/api/appJobs";
import type { PillTone } from "@/ui";

/** The state pill's tone, as the job card uses it. */
export const JOB_STATE_TONE: Record<JobState, PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export type JobSegment = "running" | "queued" | "finished" | "failed";

export const SEGMENTS: JobSegment[] = ["running", "queued", "finished", "failed"];

/** Plan decision 4: Finished holds succeeded and cancelled jobs. */
export const SEGMENT_STATES: Record<JobSegment, JobState[]> = {
  running: ["running"],
  queued: ["queued"],
  finished: ["succeeded", "cancelled"],
  failed: ["failed"],
};

/** `Job.project_id` of library jobs, and the `?project=` value that selects them. */
export const LIBRARY_FILTER = "library";

export interface JobsView {
  segment: JobSegment;
  project: string | null;
  jobId: string | null;
}

export function readJobsView(params: URLSearchParams): JobsView {
  const s = params.get("state");
  const segment = SEGMENTS.find((x) => x === s) ?? "running";
  return { segment, project: params.get("project") || null, jobId: params.get("job") || null };
}

export function jobsViewParams(v: JobsView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.segment !== "running") p.set("state", v.segment);
  if (v.project) p.set("project", v.project);
  if (v.jobId) p.set("job", v.jobId);
  return p;
}

export function inSegment(segment: JobSegment, state: JobState): boolean {
  return SEGMENT_STATES[segment].includes(state);
}

/** The Jobs section URL with this job open in the segment that lists it (toasts, re-imports). */
export function jobUrl(job: Pick<AppJob, "id" | "state">): string {
  const segment = SEGMENTS.find((s) => inSegment(s, job.state)) ?? "running";
  const query = jobsViewParams({ segment, project: null, jobId: job.id }).toString();
  return `/jobs?${query}`;
}

/** By id, `incoming` wins; newest first by `created_at`, then id, as the API orders them. */
export function mergeJobs(current: AppJob[], incoming: AppJob[]): AppJob[] {
  const byId = new Map(current.map((j) => [j.id, j]));
  for (const j of incoming) byId.set(j.id, j);
  return [...byId.values()].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

export function projectLabel(job: Pick<AppJob, "project_id" | "project_name">): string {
  if (job.project_id === LIBRARY_FILTER) return "Model library";
  return job.project_name ?? "Project";
}
