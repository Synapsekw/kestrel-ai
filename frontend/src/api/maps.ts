import type {
  ApiClient,
  GeoMap,
  Job,
  MapLabel,
  MapRun,
  MapRunCreate,
  MapScore,
  MapZone,
  components,
} from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type GeoMapWithJob = S["GeoMapWithJob"];
export type MapRunWithJob = S["MapRunWithJob"];
export type MapRunEstimate = S["MapRunEstimate"];
export type MapDetectionPage = S["MapDetectionPage"];
export type MapDensity = S["MapDensity"];
export type MapZoneCreate = S["MapZoneCreate"];
export type MapLabelCreate = S["MapLabelCreate"];
export type MapLabelUpdate = S["MapLabelUpdate"];
export type MapExportRequest = S["MapExportRequest"];

const P = "/api/v1/projects/{projectId}" as const;

export async function listMaps(api: ApiClient, projectId: string): Promise<GeoMap[]> {
  return (await unwrap(api.GET(`${P}/maps`, { params: { path: { projectId } } }))).items;
}

export function createMap(
  api: ApiClient,
  projectId: string,
  body: S["GeoMapCreate"],
): Promise<GeoMapWithJob> {
  return unwrap(api.POST(`${P}/maps`, { params: { path: { projectId } }, body }));
}

export function fetchMap(api: ApiClient, projectId: string, mapId: string): Promise<GeoMap> {
  return unwrap(api.GET(`${P}/maps/{mapId}`, { params: { path: { projectId, mapId } } }));
}

export async function deleteMap(api: ApiClient, projectId: string, mapId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/maps/{mapId}`, { params: { path: { projectId, mapId } } }));
}

export async function listMapRuns(api: ApiClient, projectId: string, mapId: string): Promise<MapRun[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/runs`, { params: { path: { projectId, mapId } } }))).items;
}

export function estimateMapRun(
  api: ApiClient,
  projectId: string,
  body: MapRunCreate,
): Promise<MapRunEstimate> {
  return unwrap(api.POST(`${P}/map-runs/estimate`, { params: { path: { projectId } }, body }));
}

export function createMapRun(api: ApiClient, projectId: string, body: MapRunCreate): Promise<MapRunWithJob> {
  return unwrap(api.POST(`${P}/map-runs`, { params: { path: { projectId } }, body }));
}

export function fetchMapRun(api: ApiClient, projectId: string, runId: string): Promise<MapRun> {
  return unwrap(api.GET(`${P}/map-runs/{runId}`, { params: { path: { projectId, runId } } }));
}

export async function resumeMapRun(api: ApiClient, projectId: string, runId: string): Promise<Job> {
  return (await unwrap(api.POST(`${P}/map-runs/{runId}/resume`, { params: { path: { projectId, runId } } })))
    .job;
}

export async function deleteMapRun(api: ApiClient, projectId: string, runId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/map-runs/{runId}`, { params: { path: { projectId, runId } } }));
}

export function fetchDetections(
  api: ApiClient,
  projectId: string,
  runId: string,
  bbox: string | null,
  minConf: number,
): Promise<MapDetectionPage> {
  const query = bbox ? { bbox, min_conf: minConf } : { min_conf: minConf };
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/detections`, { params: { path: { projectId, runId }, query } }),
  );
}

export function fetchDensity(
  api: ApiClient,
  projectId: string,
  runId: string,
  cells: number,
  minConf: number,
): Promise<MapDensity> {
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/density`, {
      params: { path: { projectId, runId }, query: { cells, min_conf: minConf } },
    }),
  );
}

export function fetchScore(api: ApiClient, projectId: string, runId: string, iou = 0.5): Promise<MapScore> {
  return unwrap(
    api.GET(`${P}/map-runs/{runId}/score`, { params: { path: { projectId, runId }, query: { iou } } }),
  );
}

export async function listZones(api: ApiClient, projectId: string, mapId: string): Promise<MapZone[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/zones`, { params: { path: { projectId, mapId } } }))).items;
}

export function createZone(
  api: ApiClient,
  projectId: string,
  mapId: string,
  body: MapZoneCreate,
): Promise<MapZone> {
  return unwrap(api.POST(`${P}/maps/{mapId}/zones`, { params: { path: { projectId, mapId } }, body }));
}

export function updateZone(
  api: ApiClient,
  projectId: string,
  mapId: string,
  zoneId: string,
  body: S["MapZoneUpdate"],
): Promise<MapZone> {
  return unwrap(
    api.PATCH(`${P}/maps/{mapId}/zones/{zoneId}`, { params: { path: { projectId, mapId, zoneId } }, body }),
  );
}

export async function deleteZone(
  api: ApiClient,
  projectId: string,
  mapId: string,
  zoneId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/maps/{mapId}/zones/{zoneId}`, { params: { path: { projectId, mapId, zoneId } } }),
  );
}

export async function listLabels(api: ApiClient, projectId: string, mapId: string): Promise<MapLabel[]> {
  return (await unwrap(api.GET(`${P}/maps/{mapId}/labels`, { params: { path: { projectId, mapId } } })))
    .items;
}

export function createLabel(
  api: ApiClient,
  projectId: string,
  mapId: string,
  body: MapLabelCreate,
): Promise<MapLabel> {
  return unwrap(api.POST(`${P}/maps/{mapId}/labels`, { params: { path: { projectId, mapId } }, body }));
}

export function updateLabel(
  api: ApiClient,
  projectId: string,
  mapId: string,
  labelId: string,
  body: MapLabelUpdate,
): Promise<MapLabel> {
  return unwrap(
    api.PATCH(`${P}/maps/{mapId}/labels/{labelId}`, {
      params: { path: { projectId, mapId, labelId } },
      body,
    }),
  );
}

export async function deleteLabel(
  api: ApiClient,
  projectId: string,
  mapId: string,
  labelId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/maps/{mapId}/labels/{labelId}`, { params: { path: { projectId, mapId, labelId } } }),
  );
}

export async function seedLabels(
  api: ApiClient,
  projectId: string,
  mapId: string,
  body: S["MapLabelSeed"],
): Promise<number> {
  return (
    await unwrap(api.POST(`${P}/maps/{mapId}/labels/seed`, { params: { path: { projectId, mapId } }, body }))
  ).created;
}

export async function createMapExport(
  api: ApiClient,
  projectId: string,
  body: MapExportRequest,
): Promise<Job> {
  return (await unwrap(api.POST(`${P}/map-exports`, { params: { path: { projectId } }, body }))).job;
}
