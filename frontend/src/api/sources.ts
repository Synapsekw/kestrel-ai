import type { ApiClient, GeoMap, Source, Stats, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

type SourceCreate = components["schemas"]["SourceCreate"];
export type SourceWithJob = components["schemas"]["SourceWithJob"];
type SourcePatch = components["schemas"]["SourcePatch"];

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

/**
 * Rename a source or correct its survey date (null clears it). On a map source the server writes the
 * map's date too, so the two stay equal.
 */
export function updateSource(
  api: ApiClient,
  projectId: string,
  sourceId: string,
  body: SourcePatch,
): Promise<Source> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/sources/{sourceId}", {
      params: { path: { projectId, sourceId } },
      body,
    }),
  );
}

/** The survey date of a map imported before maps had a source: it lives on the map row. */
export function updateMapDate(
  api: ApiClient,
  projectId: string,
  mapId: string,
  capturedOn: string | null,
): Promise<GeoMap> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/maps/{mapId}", {
      params: { path: { projectId, mapId } },
      body: { captured_on: capturedOn },
    }),
  );
}
