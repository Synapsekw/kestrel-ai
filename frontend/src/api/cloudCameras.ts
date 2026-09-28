import type { ApiClient, CloudCameraSet, CloudCameraSource } from "@contract/client";
import { unwrap } from "./errors";

const P = "/api/v1/projects/{projectId}" as const;

/** The drone photos near a cloud as parallel arrays (C-B3; spec §10.1). 409 `needs_coordinates` without a CRS. */
export function getCloudCameras(api: ApiClient, projectId: string, cloudId: string): Promise<CloudCameraSet> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}/cameras`, { params: { path: { projectId, cloudId } } }));
}

/** One image set's camera height offset for this cloud, −500…500 m (spec §10.1, C8). */
export function setCloudCameraOffset(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  sourceId: string,
  heightOffsetM: number,
): Promise<CloudCameraSource> {
  return unwrap(
    api.PUT(`${P}/pointclouds/{cloudId}/cameras/offsets/{sourceId}`, {
      params: { path: { projectId, cloudId, sourceId } },
      body: { height_offset_m: heightOffsetM },
    }),
  );
}
