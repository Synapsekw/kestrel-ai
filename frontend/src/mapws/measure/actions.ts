import type { ApiClient } from "@contract/client";
import { codeOf, isNotImplemented, messageOf } from "@/api/errors";
import {
  createMapMeasurement,
  deleteMapMeasurement,
  type MapMeasurement,
  type MapMeasurementCreate,
} from "@/api/mapMeasurements";
import type { CompareMode } from "@/mapws/annotations/bindings";
import type { MeasureKind } from "@/mapws/annotations/format";
import {
  mapOfDate,
  pickDsm,
  pickProfileSurfaces,
  type PickLayer,
  type Shown,
} from "@/mapws/annotations/pick";
import { dedupe, openRing } from "@/mapws/annotations/planar";
import { useMeasurementsStore } from "./store";

/** Spec §9.1: ≤ 5 000 vertices. */
export const MAX_MEASURE_VERTICES = 5000;
export const PROFILE_NEEDS_ELEVATION =
  "Profile needs an elevation layer — import one or build a DSM from a point cloud";

/** A refusal decided on the client (toasted as info, W3-16). */
export class MeasureRefusal extends Error {}

export interface MeasureContext {
  view: { l: string | null; r: string | null; mode: CompareMode };
  layers: readonly PickLayer[];
  /** Visibility, panel order and the session's gone keys (M-W3 P4). */
  shown: Shown;
}

export function measurementBody(
  kind: MeasureKind,
  coords: readonly number[][],
  ctx: MeasureContext,
): MapMeasurementCreate {
  // Review Focus 1: a double-click's repeated last vertex never reaches the server.
  const pts = dedupe(coords);
  let vertices: number[][];
  if (kind === "area") {
    vertices = openRing(pts);
    if (vertices.length < 3) throw new MeasureRefusal("An area needs at least three corners.");
  } else {
    vertices = pts;
    if (vertices.length < 2) throw new MeasureRefusal("A line needs two different points.");
  }
  if (vertices.length > MAX_MEASURE_VERTICES)
    throw new MeasureRefusal(`A measurement can have at most ${MAX_MEASURE_VERTICES} vertices.`);
  let surfaceIds: string[] = [];
  if (kind === "profile") {
    surfaceIds = pickProfileSurfaces(ctx.layers, ctx.shown, ctx.view).map((l) => l.id);
    if (surfaceIds.length === 0) throw new MeasureRefusal(PROFILE_NEEDS_ELEVATION);
  } else if (kind === "distance") {
    const dsm = pickDsm(ctx.layers, ctx.shown, ctx.view.r);
    if (dsm) surfaceIds = [dsm.id];
  }
  // W3-8: no name — the server numbers "Distance 3".
  return {
    kind,
    vertices,
    ...(surfaceIds.length ? { surface_ids: surfaceIds } : {}),
    map_id: mapOfDate(ctx.layers, ctx.shown, ctx.view.r)?.id ?? null,
  };
}

export function createMeasurement(
  api: ApiClient,
  projectId: string,
  kind: MeasureKind,
  coords: readonly number[][],
  ctx: MeasureContext,
): Promise<MapMeasurement> {
  try {
    return createMapMeasurement(api, projectId, measurementBody(kind, coords, ctx));
  } catch (e) {
    return Promise.reject(e);
  }
}

/** A refusal (client, or the server's with the spec's copy) toasts `info`; anything else `danger` (W3-16, T5a). */
export function isMeasureRefusal(e: unknown): boolean {
  return e instanceof MeasureRefusal || codeOf(e) === "no_surface_under_line";
}

export function createFailure(e: unknown): string {
  if (e instanceof MeasureRefusal) return e.message;
  if (isNotImplemented(e)) return "Measurements need the map measurement backend (M-B4)";
  if (codeOf(e) === "no_surface_under_line") return "No elevation under this line";
  if (codeOf(e) === "not_ready") return "A surface is still being built — try again when it is ready";
  return messageOf(e, "could not save the measurement");
}

/** The inspector's Delete and W1's `Del`: delete, then drop it from the layer at once. */
export async function removeMeasurement(api: ApiClient, projectId: string, id: string): Promise<void> {
  await deleteMapMeasurement(api, projectId, id);
  useMeasurementsStore.getState().remove(id);
}
