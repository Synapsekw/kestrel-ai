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

export async function createCloudMeasurement(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  body: S["CloudMeasurementCreate"],
): Promise<CloudMeasurement> {
  // A profile answers 202 with { measurement, job } (C-B2); every other kind answers 201 with the
  // measurement directly (contract 2026-09-27, unit C-C0).
  const result = await unwrap(api.POST(P, { params: { path: { projectId, cloudId } }, body }));
  return "measurement" in result ? result.measurement : result;
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
