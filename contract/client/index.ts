import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];
export type Health = Schemas["Health"];
export type Project = Schemas["Project"];
export type ClassDef = Schemas["ClassDef"];
export type ClassDefInput = Schemas["ClassDefInput"];
export type ImportSettings = Schemas["ImportSettings"];
export type Stats = Schemas["Stats"];
export type Source = Schemas["Source"];
export type Image = Schemas["Image"];
export type ImagePage = Schemas["ImagePage"];
export type Box = Schemas["Box"];
export type BoxCreate = Schemas["BoxCreate"];
export type BoxUpdate = Schemas["BoxUpdate"];
export type Provenance = Schemas["Provenance"];
export type ReviewState = Schemas["ReviewState"];
export type Dataset = Schemas["Dataset"];
export type DatasetStats = Schemas["DatasetStats"];
export type Model = Schemas["Model"];
export type ModelMetrics = Schemas["ModelMetrics"];
export type StarterModel = Schemas["StarterModel"];
export type StarterModelKey = Schemas["StarterModelKey"];
export type TrainRequest = Schemas["TrainRequest"];
export type Provider = Schemas["Provider"];
export type ProviderName = Schemas["ProviderName"];
export type QueryRun = Schemas["QueryRun"];
export type QueryRunCreate = Schemas["QueryRunCreate"];
export type Tiling = Schemas["Tiling"];
export type CostEstimate = Schemas["CostEstimate"];
export type Job = Schemas["Job"];
export type JobState = Schemas["JobState"];
export type JobType = Schemas["JobType"];
export type JobLog = Schemas["JobLog"];
export type ApiError = Schemas["Error"];
export type AppEvent = Schemas["Event"];
export type GeoMap = Schemas["GeoMap"];
export type MapRun = Schemas["MapRun"];
export type MapRunCreate = Schemas["MapRunCreate"];
export type MapDetection = Schemas["MapDetection"];
export type MapZone = Schemas["MapZone"];
export type MapLabel = Schemas["MapLabel"];
export type MapScore = Schemas["MapScore"];

export interface ApiClientOptions {
  /** Backend origin, e.g. http://127.0.0.1:8765 (no path). */
  baseUrl: string;
  /** Per-launch token; sent as `Authorization: Bearer`. */
  token: string;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    fetch: opts.fetch,
  });
  const auth: Middleware = {
    onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${opts.token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Websocket URL for `/api/v1/events` with the token as a query parameter. */
export function eventsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/events?token=${encodeURIComponent(token)}`;
}

/** URL for an `<img src>`: the token goes in the query because images cannot send headers. */
export function imageFileUrl(baseUrl: string, token: string, projectId: string, imageId: string, maxSide?: number): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (maxSide) q.set("max_side", String(maxSide));
  return `${base}/api/v1/projects/${projectId}/images/${imageId}/file?${q}`;
}

export function thumbnailUrl(baseUrl: string, token: string, projectId: string, imageId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/projects/${projectId}/images/${imageId}/thumbnail?token=${encodeURIComponent(token)}`;
}

/** OpenLayers tile URL template for a map: `{z}`, `{x}` and `{y}` are left for the source to fill. */
export function mapTileUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/tiles/{z}/{x}/{y}?${q}`;
}

export function mapPreviewUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/preview?${q}`;
}
