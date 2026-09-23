import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type SiteArea = S["SiteArea"];
export type SiteAreaCreate = S["SiteAreaCreate"];
export type SiteAreaPatch = S["SiteAreaPatch"];

export async function listSiteAreas(api: ApiClient, projectId: string): Promise<SiteArea[]> {
  const page = await unwrap(
    api.GET("/api/v1/projects/{projectId}/site-areas", { params: { path: { projectId } } }),
  );
  return page.items;
}

/** 201; the server starts an `area_recount` job over every map run. */
export function createSiteArea(api: ApiClient, projectId: string, body: SiteAreaCreate): Promise<SiteArea> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/site-areas", { params: { path: { projectId } }, body }),
  );
}

export function updateSiteArea(
  api: ApiClient,
  projectId: string,
  areaId: string,
  body: SiteAreaPatch,
): Promise<SiteArea> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/site-areas/{areaId}", {
      params: { path: { projectId, areaId } },
      body,
    }),
  );
}

export async function deleteSiteArea(api: ApiClient, projectId: string, areaId: string): Promise<void> {
  await unwrap(
    api.DELETE("/api/v1/projects/{projectId}/site-areas/{areaId}", {
      params: { path: { projectId, areaId } },
    }),
  );
}
