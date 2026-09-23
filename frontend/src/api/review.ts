import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type MapDetection = S["MapDetection"];
export type MapDetectionCreate = S["MapDetectionCreate"];
export type ReviewAction = S["MapDetectionReview"]["action"];
export type NextUnreviewed = S["NextUnreviewed"];
export type RunSummary = S["RunSummary"];

const P = "/api/v1/projects/{projectId}" as const;
/** Runs per source: a source rarely has more than a handful, and the newest come first. */
const SOURCE_RUNS_LIMIT = 50;

/** Accept, reject, unreview or reclass map detections; the run's counts follow on the server. */
export async function reviewMapDetections(
  api: ApiClient,
  projectId: string,
  runId: string,
  detectionIds: string[],
  action: ReviewAction,
  classId?: string,
): Promise<number> {
  const body = classId
    ? { detection_ids: detectionIds, action, class_id: classId }
    : { detection_ids: detectionIds, action };
  return (
    await unwrap(api.POST(`${P}/map-runs/{runId}/review`, { params: { path: { projectId, runId } }, body }))
  ).updated;
}

/** A missed object drawn by a person: stored accepted, counted as verified. */
export function addMapDetection(
  api: ApiClient,
  projectId: string,
  runId: string,
  body: MapDetectionCreate,
): Promise<MapDetection> {
  return unwrap(
    api.POST(`${P}/map-runs/{runId}/detections`, { params: { path: { projectId, runId } }, body }),
  );
}

/** The next unreviewed detection in reading order after `afterId` (null starts from the top). */
export function nextUnreviewed(
  api: ApiClient,
  projectId: string,
  runId: string,
  afterId: string | null,
): Promise<NextUnreviewed> {
  const query = afterId ? { after_id: afterId } : {};
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/next-unreviewed`, { params: { path: { projectId, runId }, query } }),
  );
}

/** Starts an `accept_above` job for a photo or map run. */
export async function acceptRunAbove(
  api: ApiClient,
  projectId: string,
  runId: string,
  minConfidence: number,
): Promise<Job> {
  return (
    await unwrap(
      api.POST(`${P}/runs/{runId}/accept-above`, {
        params: { path: { projectId, runId } },
        body: { min_confidence: minConfidence },
      }),
    )
  ).job;
}

/** The newest runs of one source (first page only; see SOURCE_RUNS_LIMIT). */
export async function listSourceRuns(
  api: ApiClient,
  projectId: string,
  sourceId: string,
): Promise<RunSummary[]> {
  return (
    await unwrap(
      api.GET(`${P}/runs`, {
        params: { path: { projectId }, query: { source_id: sourceId, limit: SOURCE_RUNS_LIMIT } },
      }),
    )
  ).items;
}

/** The run a source is reviewed on (spec 2026-09-23 section 7.4): the pinned one, else the newest. */
export function chosenRun(runs: RunSummary[]): RunSummary | null {
  const pinned = runs.find((r) => r.pinned);
  if (pinned) return pinned;
  return runs.reduce<RunSummary | null>(
    (best, r) => (!best || r.created_at > best.created_at ? r : best),
    null,
  );
}

/** "412 of 530 reviewed". */
export function reviewProgressText(reviewed: number, total: number): string {
  return `${reviewed.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} reviewed`;
}
