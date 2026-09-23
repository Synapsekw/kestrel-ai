import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
import type { SurveyTimeline } from "./surveys";

type S = components["schemas"];
export type SourceAnalytics = S["SourceAnalytics"];
export type AreaAnalytics = S["AreaAnalytics"];
export type AreaSurvey = S["AreaSurvey"];
export type PhotoBatchAnalytics = S["PhotoBatchAnalytics"];
export type PhotoBatch = S["PhotoBatch"];
export type ClassCountRow = S["ClassCountRow"];
export type RunSummary = S["RunSummary"];

/** The survey timeline, optionally built from verified detections only. */
export function fetchTimeline(
  api: ApiClient,
  projectId: string,
  verifiedOnly: boolean,
): Promise<SurveyTimeline> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/survey-timeline", {
      params: { path: { projectId }, query: verifiedOnly ? { verified_only: true } : {} },
    }),
  );
}

export function fetchSourceAnalytics(
  api: ApiClient,
  projectId: string,
  sourceId: string,
): Promise<SourceAnalytics> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/analytics/sources/{sourceId}", {
      params: { path: { projectId, sourceId } },
    }),
  );
}

export function fetchAreaAnalytics(api: ApiClient, projectId: string): Promise<AreaAnalytics> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/analytics/areas", { params: { path: { projectId } } }));
}

export function fetchPhotoBatches(api: ApiClient, projectId: string): Promise<PhotoBatchAnalytics> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/analytics/photo-batches", { params: { path: { projectId } } }),
  );
}
