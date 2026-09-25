import type { ApiClient, Job, VolumeMeasurement, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type VolumeMeasurementCreate = S["VolumeMeasurementCreate"];
export type VolumeMeasurementPatch = S["VolumeMeasurementPatch"];
export type VolumeMeasurementWithJob = S["VolumeMeasurementWithJob"];
export type VolumeFootprints = S["VolumeFootprints"];
export type VolumeExportRequest = S["VolumeExportRequest"];
export type VolumeResults = S["VolumeResults"];
export type VolumeBase = S["VolumeBase"];
export type VolumeRing = S["VolumeRing"];
export type VolumeWarning = S["VolumeWarning"];
export type VolumeUncertainty = S["VolumeUncertainty"];
export type ExclusionPolygon = S["ExclusionPolygon"];

const P = "/api/v1/projects/{projectId}" as const;

export async function listVolumes(api: ApiClient, projectId: string): Promise<VolumeMeasurement[]> {
  return (await unwrap(api.GET(`${P}/volumes`, { params: { path: { projectId } } }))).items;
}

export function createVolume(
  api: ApiClient,
  projectId: string,
  body: VolumeMeasurementCreate,
): Promise<VolumeMeasurementWithJob> {
  return unwrap(api.POST(`${P}/volumes`, { params: { path: { projectId } }, body }));
}

export function fetchVolume(
  api: ApiClient,
  projectId: string,
  measurementId: string,
): Promise<VolumeMeasurement> {
  return unwrap(api.GET(`${P}/volumes/{measurementId}`, { params: { path: { projectId, measurementId } } }));
}

export function patchVolume(
  api: ApiClient,
  projectId: string,
  measurementId: string,
  body: VolumeMeasurementPatch,
): Promise<VolumeMeasurement> {
  return unwrap(
    api.PATCH(`${P}/volumes/{measurementId}`, { params: { path: { projectId, measurementId } }, body }),
  );
}

export async function deleteVolume(api: ApiClient, projectId: string, measurementId: string): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/volumes/{measurementId}`, { params: { path: { projectId, measurementId } } }),
  );
}

export function calculateVolume(
  api: ApiClient,
  projectId: string,
  measurementId: string,
): Promise<VolumeMeasurementWithJob> {
  return unwrap(
    api.POST(`${P}/volumes/{measurementId}/calculate`, { params: { path: { projectId, measurementId } } }),
  );
}

export function fetchFootprints(
  api: ApiClient,
  projectId: string,
  measurementId: string,
): Promise<VolumeFootprints> {
  return unwrap(
    api.GET(`${P}/volumes/{measurementId}/footprints`, { params: { path: { projectId, measurementId } } }),
  );
}

export async function createVolumeExport(
  api: ApiClient,
  projectId: string,
  body: VolumeExportRequest,
): Promise<Job> {
  return (await unwrap(api.POST(`${P}/volume-exports`, { params: { path: { projectId } }, body }))).job;
}
