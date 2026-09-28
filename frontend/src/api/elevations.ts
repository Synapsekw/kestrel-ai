import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type ElevationImportRequest = S["ElevationImportRequest"];
export type SurfaceWithJob = S["SurfaceWithJob"];

const P = "/api/v1/projects/{projectId}" as const;

/** M §7: a plain DSM/DTM GeoTIFF becomes a `dem` surface through the `elevation_import` job. */
export function importElevation(
  api: ApiClient,
  projectId: string,
  body: ElevationImportRequest,
): Promise<SurfaceWithJob> {
  return unwrap(api.POST(`${P}/elevations`, { params: { path: { projectId } }, body }));
}
