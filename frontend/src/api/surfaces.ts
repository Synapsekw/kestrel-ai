import type { ApiClient, Surface, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type SurfaceBuildRequest = S["SurfaceBuildRequest"];
export type SurfaceWithJob = S["SurfaceWithJob"];
export type SurfaceSample = S["SurfaceSample"];
export type PointCloudOut = S["PointCloudOut"];

const P = "/api/v1/projects/{projectId}" as const;

export async function listSurfaces(api: ApiClient, projectId: string): Promise<Surface[]> {
  return (await unwrap(api.GET(`${P}/surfaces`, { params: { path: { projectId } } }))).items;
}

export function createSurface(
  api: ApiClient,
  projectId: string,
  body: SurfaceBuildRequest,
): Promise<SurfaceWithJob> {
  return unwrap(api.POST(`${P}/surfaces`, { params: { path: { projectId } }, body }));
}

export function renameSurface(
  api: ApiClient,
  projectId: string,
  surfaceId: string,
  name: string,
): Promise<Surface> {
  return unwrap(
    api.PATCH(`${P}/surfaces/{surfaceId}`, { params: { path: { projectId, surfaceId } }, body: { name } }),
  );
}

export async function deleteSurface(api: ApiClient, projectId: string, surfaceId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/surfaces/{surfaceId}`, { params: { path: { projectId, surfaceId } } }));
}

export function sampleSurface(
  api: ApiClient,
  projectId: string,
  surfaceId: string,
  x: number,
  y: number,
): Promise<SurfaceSample> {
  return unwrap(
    api.GET(`${P}/surfaces/{surfaceId}/sample`, {
      params: { path: { projectId, surfaceId }, query: { x, y } },
    }),
  );
}

/**
 * The project's point clouds, for the build dialog. S1 owns the clouds API module; this one call is
 * made here so the two specs never edit the same file.
 */
export async function listCloudsForBuild(api: ApiClient, projectId: string): Promise<PointCloudOut[]> {
  return (await unwrap(api.GET(`${P}/pointclouds`, { params: { path: { projectId } } }))).items;
}
