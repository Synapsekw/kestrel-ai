import type { GeoMap, Source } from "@contract/client";
import { codeOf, messageOf } from "@/api/errors";
import type { RunCreate } from "@/api/runs";
import { formatSurveyDate, mapSurveyDate } from "@/mapws/w4host";

export const LAST_MODEL_KEY = "kestrel.mapws.lastDetectModel";

/** A map gets its detection source when it is imported (backend `maps/service.create_map`). */
export const NO_SOURCE =
  "This orthomosaic has no detection source, so AI detect cannot scan it. Import it again in Maps, then draw the box again.";

export function readLastModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY);
  } catch {
    return null;
  }
}
export function writeLastModel(id: string): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, id);
  } catch {
    // a blocked storage only loses the default
  }
}

/** W1's Box geometry `[minE, minN, maxE, maxN]` as the open ring RunRegion.polygon_site takes. */
export function extentRing(e: [number, number, number, number]): number[][] {
  return [
    [e[0], e[1]],
    [e[2], e[1]],
    [e[2], e[3]],
    [e[0], e[3]],
  ];
}

/** Orthos of the r date with coordinates, newest import first (R-W4-11). */
export function regionMaps(maps: GeoMap[], r: string | null): GeoMap[] {
  if (r == null) return [];
  return maps
    .filter((m) => m.status === "ready" && m.crs_wkt != null && mapSurveyDate(m) === r)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The map's own detection source; never the map id (the server wants exactly that map's source). */
export function regionSourceId(sources: Pick<Source, "id" | "map_id">[], mapId: string): string | null {
  return sources.find((s) => s.map_id === mapId)?.id ?? null;
}

export function regionProblem(input: {
  maps: GeoMap[];
  r: string | null;
  model: { train_gsd_cm: number | null } | null;
}): string | null {
  if (input.maps.length === 0)
    return `AI detect needs an orthomosaic of ${formatSurveyDate(input.r)} under the box.`;
  if (!input.model) return "Choose a model.";
  if (!input.model.train_gsd_cm)
    return "Set the scale this model was trained at in Run detection first — a run at the wrong scale finds nothing, or finds the wrong thing.";
  return null;
}

export function regionBody(input: {
  sourceId: string;
  mapId: string;
  ring: number[][];
  modelId: string;
  conf: number;
  gsdCm: number;
}): RunCreate {
  return {
    source_ids: [input.sourceId],
    model_id: input.modelId,
    conf: input.conf,
    target_gsd_cm: input.gsdCm,
    region: { map_id: input.mapId, polygon_site: input.ring },
  };
}

export function regionError(err: unknown): string {
  const code = codeOf(err);
  if (code === "empty_region")
    return "Nothing to scan in this box: it has no map pixels under it. Draw the box over the orthomosaic.";
  if (code === "unmapped_classes")
    return "This model has classes the project has no type for. Map them once in Run detection, then run the region again.";
  return messageOf(err, "could not start the run");
}
