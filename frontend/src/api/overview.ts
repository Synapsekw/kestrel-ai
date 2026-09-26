import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

export type ProjectOverview = components["schemas"]["ProjectOverview"];

/** F §9.1: one pre-aggregated read; it never scans findings, boxes or images. */
export function fetchOverview(api: ApiClient, projectId: string): Promise<ProjectOverview> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/overview", { params: { path: { projectId } } }));
}
