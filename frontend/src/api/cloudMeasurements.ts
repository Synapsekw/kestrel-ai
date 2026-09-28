import type { ApiClient, components, Job } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type CloudMeasurement = S["CloudMeasurementOut"];
export type CloudMeasurementCreate = S["CloudMeasurementCreate"];
export type CloudMeasurementWithJob = S["CloudMeasurementWithJob"];
export type CloudProfile = S["CloudProfile"];

/** A create's answer, whichever status it came with: 201 the measurement, a profile's 202 the
 * measurement and its `pointcloud_profile` job (spec 2026-09-26-point-cloud-workspace section 12 row 8). */
export interface SavedCloudMeasurement {
  measurement: CloudMeasurement;
  job: Job | null;
}

export function isWithJob(v: CloudMeasurement | CloudMeasurementWithJob): v is CloudMeasurementWithJob {
  return "measurement" in v;
}

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
  body: CloudMeasurementCreate,
): Promise<SavedCloudMeasurement> {
  const r: CloudMeasurement | CloudMeasurementWithJob = await unwrap(
    api.POST(P, { params: { path: { projectId, cloudId } }, body }),
  );
  return isWithJob(r) ? { measurement: r.measurement, job: r.job } : { measurement: r, job: null };
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

/** Re-runs a failed profile's job (`retryCloudProfile`, 202 `JobRef`; 409 `not_retryable` otherwise). */
export async function retryCloudProfile(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
): Promise<Job> {
  const r = await unwrap(
    api.POST(`${P}/{cloudMeasurementId}/retry`, {
      params: { path: { projectId, cloudId, cloudMeasurementId } },
    }),
  );
  return r.job;
}

/** The stored profile of a `ready` profile measurement (≤ 500 000 points; 409 `not_ready` while computing). */
export function getCloudProfile(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
): Promise<CloudProfile> {
  return unwrap(
    api.GET(`${P}/{cloudMeasurementId}/profile`, {
      params: { path: { projectId, cloudId, cloudMeasurementId } },
    }),
  );
}
