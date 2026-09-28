import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

type S = components["schemas"];
const P = "/api/v1/projects/{projectId}" as const;

export type MapMeasurement = S["MapMeasurement"];
export type MapMeasurementKind = S["MapMeasurementKind"];
export type MapMeasurementCreate = S["MapMeasurementCreate"];
export type MapMeasurementPatch = S["MapMeasurementPatch"];

/** Spec §13: the layer reads at most 2 000 measurements, 500 a page. */
export const MEASUREMENTS_PAGE = 500;
export const MEASUREMENTS_LAYER_MAX = 2000;

const MAX_PAGES = MEASUREMENTS_LAYER_MAX / MEASUREMENTS_PAGE;

/**
 * Every map measurement with `vertices_site`, bounded to `MEASUREMENTS_LAYER_MAX`. `truncated` is
 * true only when the last page fetched (the cap) still carried a `next_cursor` — not merely that the
 * cap was reached, so a project with exactly 2 000 measurements and no more is not flagged (M-W3
 * preflight P14).
 */
export async function listMapMeasurementsInFrame(
  api: ApiClient,
  projectId: string,
): Promise<{ items: MapMeasurement[]; truncated: boolean }> {
  let pages = 0;
  let lastCursor: string | null = null;
  const items = await collectPages<MapMeasurement>((cursor) => {
    pages += 1;
    return unwrap(
      api.GET(`${P}/map-measurements`, {
        params: {
          path: { projectId },
          query: {
            frame: "site",
            limit: MEASUREMENTS_PAGE,
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ).then((page) => {
      lastCursor = page.next_cursor;
      return page;
    });
  }, MAX_PAGES);
  return {
    items,
    truncated: pages >= MAX_PAGES && lastCursor !== null,
  };
}

export function getMapMeasurement(
  api: ApiClient,
  projectId: string,
  mapMeasurementId: string,
): Promise<MapMeasurement> {
  return unwrap(
    api.GET(`${P}/map-measurements/{mapMeasurementId}`, {
      params: {
        path: { projectId, mapMeasurementId },
        query: { frame: "site" },
      },
    }),
  );
}

/** `vertices` are in the current site frame; the server computes `results` (spec M13). */
export function createMapMeasurement(
  api: ApiClient,
  projectId: string,
  body: MapMeasurementCreate,
): Promise<MapMeasurement> {
  return unwrap(
    api.POST(`${P}/map-measurements`, {
      params: { path: { projectId } },
      body,
    }),
  );
}

/** PATCH recomputes `results` when `vertices` or `surface_ids` change. */
export function patchMapMeasurement(
  api: ApiClient,
  projectId: string,
  mapMeasurementId: string,
  patch: MapMeasurementPatch,
): Promise<MapMeasurement> {
  return unwrap(
    api.PATCH(`${P}/map-measurements/{mapMeasurementId}`, {
      params: { path: { projectId, mapMeasurementId } },
      body: patch,
    }),
  );
}

export async function deleteMapMeasurement(
  api: ApiClient,
  projectId: string,
  mapMeasurementId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/map-measurements/{mapMeasurementId}`, {
      params: { path: { projectId, mapMeasurementId } },
    }),
  );
}
