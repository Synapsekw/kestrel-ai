import type { ApiClient, components, Image as ImageRow } from "@contract/client";
import { unwrap } from "./errors";
import { fetchImagePage } from "./images";

export type ProjectOverview = components["schemas"]["ProjectOverview"];
export type OverviewSite = components["schemas"]["OverviewSite"];
export type OverviewHero = components["schemas"]["OverviewHero"];

/** F §9.1: one pre-aggregated read; it never scans findings, boxes or images. */
export function fetchOverview(api: ApiClient, projectId: string): Promise<ProjectOverview> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/overview", { params: { path: { projectId } } }));
}

/** Spec 2026-09-30-project-landing §4.2: read after `/overview`, never gating it. */
export function fetchOverviewSite(api: ApiClient, projectId: string): Promise<OverviewSite> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/overview/site", { params: { path: { projectId } } }));
}

/** The newest frames for the mosaic and the imagery pane: one bounded page. */
export async function fetchLatestImages(
  api: ApiClient,
  projectId: string,
  limit: number,
): Promise<ImageRow[]> {
  const page = await fetchImagePage(api, projectId, { sort: "capture_time", order: "desc", limit });
  return page.items;
}
