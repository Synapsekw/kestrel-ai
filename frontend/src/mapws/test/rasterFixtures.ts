import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ApiClient, components } from "@contract/client";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { WorkspaceProvider, type WorkspaceStores } from "../context";
import type { WorkspaceLayer } from "../types";
import { layer } from "./fixtures";

type S = components["schemas"];

export const JUL = "2026-07-15";
export const AUG = "2026-08-14";
export const SEP = "2026-09-14";
export const OCT = "2026-10-14";
/** A site-frame footprint (minx, miny, maxx, maxy) inside W1's UTM33 test frame. */
export const FOOT: [number, number, number, number] = [500000, 4981200, 502400, 4983000];

/** A ready, in-frame ortho row of listWorkspaceLayers (M-C0's `WorkspaceLayer`, snake_case). */
export function mapLayer(id: string, date: string | null, extra: Partial<WorkspaceLayer> = {}): WorkspaceLayer {
  return layer("map", id, {
    name: `${id}.tif`,
    date,
    meta: "3.0 cm · 2.4 GB",
    footprint_site: FOOT,
    ...extra,
  });
}

/** A ready, in-frame surface row; `surface_kind` and `elevation_role` are top-level contract fields. */
export function surfaceLayer(
  id: string,
  date: string | null,
  surfaceKind: S["SurfaceKind"] = "cloud_dsm",
  extra: Partial<WorkspaceLayer> = {},
): WorkspaceLayer {
  const role: S["ElevationRole"] | null =
    surfaceKind === "design" ? null : surfaceKind === "dem" ? "dtm" : "dsm";
  return layer("surface", id, {
    name: id,
    date,
    meta: surfaceKind === "design" ? "from Site plan rev C" : "598.1 – 624.8 m",
    footprint_site: FOOT,
    surface_kind: surfaceKind,
    elevation_role: role,
    ...extra,
  });
}

/** One entry of `WorkspaceSurvey.maps` (use with W1's `survey(date, { maps: [...] })`). */
export function surveyMap(id: string, extra: Partial<S["WorkspaceSurveyMap"]> = {}): S["WorkspaceSurveyMap"] {
  return { id, name: id, gsd_cm: 3, basis_run_id: null, ...extra };
}

/** One entry of `WorkspaceSurvey.surfaces`. */
export function surveySurface(
  id: string,
  kind: S["SurfaceKind"] = "cloud_dsm",
  role: S["ElevationRole"] | null = null,
): S["WorkspaceSurveySurface"] {
  return { id, name: id, kind, elevation_role: role };
}

/** What W2's tests return from a `vi.mock` of W1's `useWorkspaceLayers()`; set it per test. */
export const layerFeed: { layers: WorkspaceLayer[]; loading: boolean } = {
  layers: [],
  loading: false,
};

/** The slice of `ol/Map` a raster mount touches, with spies. */
export function fakeOlMap() {
  return {
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    render: vi.fn(),
    getView: () => ({ getProjection: () => "EPSG:32633" }),
  };
}

/**
 * A `wrapper` for Testing Library's `render(ui, { wrapper })`: the API context, a memory router and
 * the workspace stores. Unlike W1's `renderInWorkspace`, whose `rerender` drops the providers, a
 * wrapper survives `rerender` (Task 4's RasterMount and useRasterLayers tests rerender).
 */
export function workspaceWrapper(
  stores: WorkspaceStores,
  opts: { api?: ApiClient; route?: string } = {},
) {
  const api = opts.api ?? fakeClient([]).api;
  const route = opts.route ?? `/p/${PROJECT_ID}/maps`;
  return function Wrapper({ children }: { children: ReactNode }) {
    const inner = createElement(WorkspaceProvider, { value: stores, children });
    const routed = createElement(MemoryRouter, { initialEntries: [route], children: inner });
    return createElement(TestApiProvider, { api, children: routed });
  };
}
