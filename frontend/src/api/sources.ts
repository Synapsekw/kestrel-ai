import type { ApiClient, Source, Stats, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type SourceCreate = components["schemas"]["SourceCreate"];
export type SourceWithJob = components["schemas"]["SourceWithJob"];

const LIST_LIMIT = 1000;

/** Every source (S2's `fetchSources` in `api/project.ts` reads the first page only). */
export function fetchAllSources(api: ApiClient, projectId: string): Promise<Source[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/sources", {
        params: {
          path: { projectId },
          query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT },
        },
      }),
    ),
  );
}

export function fetchSourceStats(api: ApiClient, projectId: string, sourceId: string): Promise<Stats> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/sources/{sourceId}/stats", {
      params: { path: { projectId, sourceId } },
    }),
  );
}

/** 202: registers the folder (or re-uses it) and starts the import job; re-posting imports new files only. */
export function createSource(api: ApiClient, projectId: string, body: SourceCreate): Promise<SourceWithJob> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/sources", { params: { path: { projectId } }, body }));
}
