import type { ApiClient, components, Job } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type PointCloud = S["PointCloudOut"];

const P = "/api/v1/projects/{projectId}" as const;

export function fetchPointCloud(api: ApiClient, projectId: string, cloudId: string): Promise<PointCloud> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } } }));
}

export type PointCloudWithJob = S["PointCloudWithJob"];
export type PointCloudFileInfo = S["PointCloudFileInfo"];
export type PointCloudPatch = S["PointCloudPatch"];

export async function listPointClouds(api: ApiClient, projectId: string): Promise<PointCloud[]> {
  return (await unwrap(api.GET(`${P}/pointclouds`, { params: { path: { projectId } } }))).items;
}

export function createPointCloud(
  api: ApiClient,
  projectId: string,
  body: S["PointCloudCreate"],
): Promise<PointCloudWithJob> {
  return unwrap(api.POST(`${P}/pointclouds`, { params: { path: { projectId } }, body }));
}

export function inspectPointCloudFile(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<PointCloudFileInfo> {
  return unwrap(api.POST(`${P}/pointclouds/inspect`, { params: { path: { projectId } }, body: { path } }));
}

export function patchPointCloud(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  body: PointCloudPatch,
): Promise<PointCloud> {
  return unwrap(api.PATCH(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId } }, body }));
}

/** `deleteFindings` also deletes the findings anchored on the cloud; without it the server answers
 * 409 `cloud_has_findings` with `details.count` when there are any (spec C14). */
export async function deletePointCloud(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  opts: { deleteFindings?: boolean } = {},
): Promise<void> {
  const query = opts.deleteFindings ? { delete_findings: true } : undefined;
  await unwrap(api.DELETE(`${P}/pointclouds/{cloudId}`, { params: { path: { projectId, cloudId }, query } }));
}

export async function createPointCloudExport(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  includeMeasurements: boolean,
): Promise<Job> {
  const body = { format: "laz" as const, include_measurements: includeMeasurements };
  return (
    await unwrap(
      api.POST(`${P}/pointclouds/{cloudId}/exports`, { params: { path: { projectId, cloudId } }, body }),
    )
  ).job;
}
