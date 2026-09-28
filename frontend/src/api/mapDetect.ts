import type { ApiClient, components } from "@contract/client";
import { ApiFailure, unwrap } from "./errors";
import type { MapDensity, MapDetectionPage } from "./maps";
import type { NextUnreviewed } from "./review";

export type { MapDetection, NextUnreviewed } from "./review";
export type { MapDetectionPage, MapDensity } from "./maps";

type S = components["schemas"];
export type MapDetectionReview = S["MapDetectionReview"];

const P = "/api/v1/projects/{projectId}" as const;
/** Review writes are chunked so one request never carries more than this many ids. */
export const REVIEW_CHUNK = 1000;
/** Density cells across the map when a view holds more than 5 000 boxes. */
export const DENSITY_CELLS = 64;

/** "x0,y0,x1,y1" in site units (mm precision), the `bbox` of the `frame=site` reads. */
export function siteBbox(extent: readonly number[]): string {
  return extent
    .slice(0, 4)
    .map((v) => v.toFixed(3))
    .join(",");
}

export function fetchSiteDetections(
  api: ApiClient,
  projectId: string,
  runId: string,
  bbox: string,
): Promise<MapDetectionPage> {
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/detections`, {
      params: { path: { projectId, runId }, query: { bbox, frame: "site" } },
    }),
  );
}

export function fetchSiteDensity(
  api: ApiClient,
  projectId: string,
  runId: string,
  cells = DENSITY_CELLS,
): Promise<MapDensity> {
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/density`, {
      params: { path: { projectId, runId }, query: { cells, frame: "site" } },
    }),
  );
}

export function nextUnreviewedSite(
  api: ApiClient,
  projectId: string,
  runId: string,
  afterId: string | null,
): Promise<NextUnreviewed> {
  const query = afterId ? { after_id: afterId, frame: "site" as const } : { frame: "site" as const };
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/next-unreviewed`, {
      params: { path: { projectId, runId }, query },
    }),
  );
}

/** Accept, reject, unreview or reclass; `confirmFindingDelete` answers a 409 finding_would_be_deleted. */
export async function reviewDetections(
  api: ApiClient,
  projectId: string,
  runId: string,
  body: MapDetectionReview,
  confirmFindingDelete = false,
): Promise<number> {
  const query = confirmFindingDelete ? { confirm_finding_delete: true } : {};
  return (
    await unwrap(
      api.POST(`${P}/map-runs/{runId}/review`, {
        params: { path: { projectId, runId }, query },
        body,
      }),
    )
  ).updated;
}

/** The finding ids a refused review would delete, or null when `err` is not that refusal. */
export function findingIdsToDelete(err: unknown): string[] | null {
  if (!(err instanceof ApiFailure) || err.code !== "finding_would_be_deleted") return null;
  const d = err.details as { finding_id?: unknown; finding_ids?: unknown };
  if (Array.isArray(d.finding_ids)) return d.finding_ids.map(String);
  return typeof d.finding_id === "string" ? [d.finding_id] : [];
}
