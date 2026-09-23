import type { ApiClient, GeoMap, Source, Stats, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type SourceCreate = components["schemas"]["SourceCreate"];
export type SourceWithJob = components["schemas"]["SourceWithJob"];
export type SourcePatch = components["schemas"]["SourcePatch"];
export type RunSummary = components["schemas"]["RunSummary"];

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
 * map's date too, so the two stay equal. Detection projects only.
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

/** Enough runs to cover the sources of one site; one page, never a walk over every run. */
const RUN_PAGE = 200;

/**
 * The run each source shows: its pinned run, else its newest (`GET /runs` is newest first). Reads
 * one page only, so a source whose runs are all older than that page shows none.
 */
export async function fetchRunsBySource(api: ApiClient, projectId: string): Promise<Map<string, RunSummary>> {
  const page = await unwrap(
    api.GET("/api/v1/projects/{projectId}/runs", {
      params: { path: { projectId }, query: { limit: RUN_PAGE } },
    }),
  );
  const chosen = new Map<string, RunSummary>();
  for (const run of page.items) {
    if (!run.source_id) continue;
    const had = chosen.get(run.source_id);
    if (!had || (run.pinned && !had.pinned)) chosen.set(run.source_id, run);
  }
  return chosen;
}
