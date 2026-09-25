import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type CloudMeasurement = S["CloudMeasurementOut"];

const P = "/api/v1/projects/{projectId}/pointclouds/{cloudId}/measurements" as const;

export async function listCloudMeasurements(
  api: ApiClient,
  projectId: string,
  cloudId: string,
): Promise<CloudMeasurement[]> {
  return (await unwrap(api.GET(P, { params: { path: { projectId, cloudId } } }))).items;
}

export function createCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  body: S["CloudMeasurementCreate"],
): Promise<CloudMeasurement> {
  return unwrap(api.POST(P, { params: { path: { projectId, cloudId } }, body }));
}

export function updateCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
  body: S["CloudMeasurementUpdate"],
): Promise<CloudMeasurement> {
  return unwrap(
    api.PATCH(`${P}/{cloudMeasurementId}`, {
      params: { path: { projectId, cloudId, cloudMeasurementId } },
      body,
    }),
  );
}

export async function deleteCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/{cloudMeasurementId}`, { params: { path: { projectId, cloudId, cloudMeasurementId } } }),
  );
}
