import type { ApiClient, CloudViewList } from "@contract/client";
import { unwrap } from "./errors";

const P = "/api/v1/projects/{projectId}" as const;

/**
 * The metadata of every stored report view in a cloud (spec §11.4), no image bytes, at most 1 500.
 * C-R1 appends the view3d PUT wrappers to this file (controller ruling 13).
 */
export function listCloudViews(api: ApiClient, projectId: string, cloudId: string): Promise<CloudViewList> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}/views`, { params: { path: { projectId, cloudId } } }));
}
