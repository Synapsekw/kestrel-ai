import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type PointCloud = S["PointCloudOut"];

const P = "/api/v1/projects/{projectId}" as const;

export function fetchPointCloud(api: ApiClient, projectId: string, cloudId: string): Promise<PointCloud> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } } }));
}
