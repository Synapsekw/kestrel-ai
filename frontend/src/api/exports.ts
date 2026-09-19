import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";

export type ResultsExportRequest = components["schemas"]["ResultsExportRequest"];
export type ResultsExportFormat = components["schemas"]["ResultsExportFormat"];

/**
 * A `results_export` job's `result` once it succeeds. The contract describes this shape on the
 * `createResultsExport` operation rather than as a named schema, so it is typed here by hand.
 */
export interface ResultsExportResult {
  /** Project-relative, forward slashes, e.g. "exports/2026-09-19_101500". */
  folder: string;
  /** File paths relative to `folder`. */
  files: string[];
  image_count: number;
  box_count: number;
}

/** 202 with the export job; the files land under `exports/<stamp>/` once it succeeds. */
export async function createResultsExport(
  api: ApiClient,
  projectId: string,
  body: ResultsExportRequest,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/exports", { params: { path: { projectId } }, body }),
  );
  return r.job;
}

/** Starts Explorer on a project-relative file or folder; 404 missing, 422 outside the project. */
export async function revealInExplorer(api: ApiClient, projectId: string, path: string): Promise<void> {
  await unwrap<unknown>(
    api.POST("/api/v1/projects/{projectId}/reveal", { params: { path: { projectId } }, body: { path } }),
  );
}
