import type {
  ApiClient,
  AssetModel,
  AssetModelRun,
  AssetModelRunStart,
  AssetModelVersion,
  AssetModelVersionDetail,
  AssetSpec,
  Job,
} from "@contract/client";
import { unwrap } from "./errors";

const P = "/api/v1/projects/{projectId}/asset-models" as const;
const listPath = (projectId: string) => ({ params: { path: { projectId } } });
const path = (projectId: string, assetModelId: string) => ({ params: { path: { projectId, assetModelId } } });
const vPath = (projectId: string, assetModelId: string, version: number) => ({
  params: { path: { projectId, assetModelId, version } },
});
const rPath = (projectId: string, assetModelId: string, runId: string) => ({
  params: { path: { projectId, assetModelId, runId } },
});

export async function listAssetModels(api: ApiClient, projectId: string): Promise<AssetModel[]> {
  return (await unwrap(api.GET(P, listPath(projectId)))).items;
}
export async function createAssetModel(
  api: ApiClient,
  projectId: string,
  body: { name: string; asset_type?: string | null; tag?: string | null },
): Promise<AssetModel> {
  return unwrap(api.POST(P, { ...listPath(projectId), body }));
}
export async function patchAssetModel(
  api: ApiClient,
  projectId: string,
  id: string,
  body: Partial<Pick<AssetModel, "name" | "asset_type" | "tag">>,
): Promise<AssetModel> {
  return unwrap(api.PATCH(`${P}/{assetModelId}`, { ...path(projectId, id), body }));
}
export async function deleteAssetModel(api: ApiClient, projectId: string, id: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/{assetModelId}`, path(projectId, id)));
}
export async function listVersions(api: ApiClient, projectId: string, id: string): Promise<AssetModelVersion[]> {
  return (await unwrap(api.GET(`${P}/{assetModelId}/versions`, path(projectId, id)))).items;
}
export async function getVersion(
  api: ApiClient,
  projectId: string,
  id: string,
  version: number,
): Promise<AssetModelVersionDetail> {
  return unwrap(api.GET(`${P}/{assetModelId}/versions/{version}`, vPath(projectId, id, version)));
}
export async function createVersion(
  api: ApiClient,
  projectId: string,
  id: string,
  spec: AssetSpec,
  note?: string,
): Promise<{ version: AssetModelVersion; job: Job }> {
  return unwrap(
    api.POST(`${P}/{assetModelId}/versions`, { ...path(projectId, id), body: { spec, note: note ?? null } }),
  );
}
export async function restoreVersion(
  api: ApiClient,
  projectId: string,
  id: string,
  version: number,
): Promise<{ version: AssetModelVersion; job: Job }> {
  return unwrap(api.POST(`${P}/{assetModelId}/versions/{version}/restore`, vPath(projectId, id, version)));
}
// The run wrappers are used by unit U7; the backend answers 501 until the runs unit lands.
export async function listRuns(api: ApiClient, projectId: string, id: string): Promise<AssetModelRun[]> {
  return (await unwrap(api.GET(`${P}/{assetModelId}/runs`, path(projectId, id)))).items;
}
export async function getRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun> {
  return unwrap(api.GET(`${P}/{assetModelId}/runs/{runId}`, rPath(projectId, id, runId)));
}
export async function startRun(
  api: ApiClient,
  projectId: string,
  id: string,
  body: AssetModelRunStart,
): Promise<{ run: AssetModelRun; job: Job }> {
  return unwrap(api.POST(`${P}/{assetModelId}/runs`, { ...path(projectId, id), body }));
}
export async function stopRun(api: ApiClient, projectId: string, id: string, runId: string): Promise<AssetModelRun> {
  return unwrap(api.POST(`${P}/{assetModelId}/runs/{runId}/stop`, rPath(projectId, id, runId)));
}
