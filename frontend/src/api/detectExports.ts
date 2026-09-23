import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";

export type DetectExportRequest = components["schemas"]["DetectExportRequest"];
export type DetectExportFormat = DetectExportRequest["format"];

/**
 * 202 with a `detect_export` job: a CSV of the counts (one row per source, class and site area) or
 * one PDF report per source, written under `exports/<stamp>/`. `source_id` narrows it to one source.
 */
export async function createDetectExport(
  api: ApiClient,
  projectId: string,
  body: DetectExportRequest,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/detect-exports", { params: { path: { projectId } }, body }),
  );
  return r.job;
}
