import type { ApiClient, components } from "@contract/client";
import { drawingVectorTileUrl, siteTileUrl } from "@contract/client";
import type { SiteFrame } from "@/mapws/types";
import { siteCode } from "@/mapws/view/siteFrame";
import { unwrap } from "./errors";

// M-C0's schema names (Task 1 Step 1 checks them).
type S = components["schemas"];
export type DrawingFormat = S["DrawingFormat"];
export type DrawingInspection = S["DrawingInspection"];
export type DrawingInspectionWithJob = S["DrawingInspectionWithJob"];
export type DrawingPage = S["DrawingPage"];
export type DrawingLayer = S["DrawingLayer"];
export type DrawingEmbedded = S["DrawingEmbedded"];
export type DrawingPlacementInput = S["DrawingPlacementInput"];
export type DrawingCreate = S["DrawingCreate"];
export type Drawing = S["Drawing"];
export type DrawingWithJob = S["DrawingWithJob"];
export type DrawingPatch = S["DrawingPatch"];
export type DrawingLayerState = S["DrawingLayerState"];
export type DrawingGeoref = S["DrawingGeoref"];
export type DrawingGeorefPut = S["DrawingGeorefPut"];
export type GeorefWarning = S["GeorefWarning"];
export type DrawingVectorTile = S["DrawingVectorTile"];
export type DrawingPagesCreate = S["DrawingPagesCreate"];
export type DrawingPagesWithJob = S["DrawingPagesWithJob"];
export type UnimportedDrawing = S["UnimportedDrawing"];

const P = "/api/v1/projects/{projectId}" as const;

export function createDrawingInspection(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<DrawingInspectionWithJob> {
  return unwrap(
    api.POST(`${P}/drawing-inspections`, {
      params: { path: { projectId } },
      body: { path },
    }),
  );
}

export function getDrawingInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<DrawingInspection> {
  return unwrap(
    api.GET(`${P}/drawing-inspections/{inspectionId}`, {
      params: { path: { projectId, inspectionId } },
    }),
  );
}

export async function listDrawings(api: ApiClient, projectId: string): Promise<Drawing[]> {
  return (await unwrap(api.GET(`${P}/drawings`, { params: { path: { projectId } } }))).items;
}

export function createDrawing(
  api: ApiClient,
  projectId: string,
  body: DrawingCreate,
): Promise<DrawingWithJob> {
  return unwrap(api.POST(`${P}/drawings`, { params: { path: { projectId } }, body }));
}

/** Every chosen page of a PDF, one `drawing_import` job (plant-model spec §8.1). */
export function createDrawingPages(
  api: ApiClient,
  projectId: string,
  body: DrawingPagesCreate,
): Promise<DrawingPagesWithJob> {
  return unwrap(api.POST(`${P}/drawings/pages`, { params: { path: { projectId } }, body }));
}

/** Drawing files in the project folder that were never imported (≤ 500). */
export async function listUnimportedDrawings(
  api: ApiClient,
  projectId: string,
): Promise<UnimportedDrawing[]> {
  return (await unwrap(api.GET(`${P}/drawings/unimported`, { params: { path: { projectId } } }))).files;
}

export function patchDrawing(
  api: ApiClient,
  projectId: string,
  drawingId: string,
  body: DrawingPatch,
): Promise<Drawing> {
  return unwrap(
    api.PATCH(`${P}/drawings/{drawingId}`, {
      params: { path: { projectId, drawingId } },
      body,
    }),
  );
}

export async function deleteDrawing(api: ApiClient, projectId: string, drawingId: string): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/drawings/{drawingId}`, {
      params: { path: { projectId, drawingId } },
    }),
  );
}

export function putDrawingGeoref(
  api: ApiClient,
  projectId: string,
  drawingId: string,
  body: DrawingGeorefPut,
): Promise<Drawing> {
  return unwrap(
    api.PUT(`${P}/drawings/{drawingId}/georef`, {
      params: { path: { projectId, drawingId } },
      body,
    }),
  );
}

export function clearDrawingGeoref(api: ApiClient, projectId: string, drawingId: string): Promise<Drawing> {
  return unwrap(
    api.DELETE(`${P}/drawings/{drawingId}/georef`, {
      params: { path: { projectId, drawingId } },
    }),
  );
}

function root(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}`;
}

export function pageThumbUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  page: number,
): string {
  return `${root(baseUrl, projectId)}/drawing-inspections/${inspectionId}/pages/${page}/thumbnail?${new URLSearchParams({ token })}`;
}

/**
 * The `frame_key` of a tile URL (R-W5-14): the one site-tile cache key W2-12 already uses
 * (`"EPSG:32638"`, `"kestrel-local"`, or a `kestrel-site-<hash>` for a CRS frame with no EPSG).
 * Preflight adaptation #4/PF3: this is `siteCode`, not a bespoke `<epsg|local>` string.
 */
export function frameKey(frame: SiteFrame): string {
  return siteCode(frame);
}

export interface TileQuery {
  /** The row's `version` (M-C0 `WorkspaceLayer.version`). */
  v: string;
  /** The tile cache key of the site frame (`frameKey`/`siteCode`). */
  frame: string;
  /** A drawing → site-frame affine replacing the stored georef: the K tool's live preview (R-W5-4). */
  preview?: readonly number[] | null;
  knockout?: boolean;
}

function extras(q: TileQuery): Record<string, string> {
  const e: Record<string, string> = { frame_key: q.frame };
  if (q.preview) e.t = q.preview.map(String).join(",");
  if (q.knockout) e.knockout = "true";
  return e;
}

/**
 * OpenLayers template ({z}/{x}/{y} on the site grid) for a DXF/LandXML drawing's vector tiles.
 * Preflight adaptation #5/PF3: wraps the contract client's `drawingVectorTileUrl` instead of
 * re-deriving the path, and appends `frame_key`/`t` as extra query params.
 */
export function vectorTileTemplate(
  baseUrl: string,
  token: string,
  projectId: string,
  drawingId: string,
  q: TileQuery,
): string {
  const base = drawingVectorTileUrl(baseUrl, token, projectId, drawingId, q.v);
  const extra = new URLSearchParams(extras(q));
  return `${base}&${extra}`;
}

/**
 * OpenLayers template for a raster drawing's site tiles (kind `drawing_raster`; W1's `siteTileUrl`
 * shape). Preflight adaptation #5/PF3: wraps the contract client's `siteTileUrl`.
 */
export function rasterTileTemplate(
  baseUrl: string,
  token: string,
  projectId: string,
  drawingId: string,
  q: TileQuery,
): string {
  return siteTileUrl(baseUrl, token, projectId, "drawing_raster", drawingId, q.v, extras(q));
}
