import type { ClassDef, GeoMap, MapRun, Provider, ProviderName } from "@contract/client";
import type { MapDensity } from "@/api/maps";
import { makeReadout, type Readout } from "./coords";

export const MAX_COMPARE = 2;

/**
 * `openapi-typescript` turns any schema property carrying a `default` into a required TS property,
 * so `MapRunCreate` requires `tile_size`, `overlap`, `nms_iou` and `conf` explicitly (the precedent
 * is `DEFAULT_TILING`/`DEFAULT_CONF` in `api/queryRuns.ts`). These are the documented defaults;
 * spread them into both the estimate and the create call.
 */
export const DEFAULT_MAP_RUN = { tile_size: 1280, overlap: 0.2, nms_iou: 0.5, conf: 0.25 } as const;

export function defaultTargetGsd(
  runs: MapRun[],
  modelId: string | null,
  mapGsd: number | null,
): number | null {
  const last = runs
    .filter((r) => r.model_id === modelId && r.target_gsd_cm)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return last?.target_gsd_cm ?? mapGsd;
}

export function countsFromDensity(d: MapDensity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of d.cells) out[c.class_id] = (out[c.class_id] ?? 0) + c.count;
  return out;
}

export function toggleCompare(selected: string[], runId: string): string[] {
  if (selected.includes(runId)) return selected.filter((id) => id !== runId);
  return [...selected, runId].slice(-MAX_COMPARE);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

export function runTitle(run: MapRun): string {
  const d = new Date(run.created_at);
  const when = `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${run.model_name ?? run.provider ?? "Run"} · ${when}`;
}

export type RunForm =
  | { kind: "local_model"; modelId: string }
  | { kind: "cloud_provider"; provider: ProviderName; query: string };

export function validateRunForm(form: RunForm, providers: Provider[]): string | null {
  if (form.kind === "local_model") return form.modelId ? null : "Choose a model.";
  if (!providers.find((p) => p.name === form.provider)?.has_key) {
    return "Add an API key for this provider in App settings first.";
  }
  return form.query.trim() ? null : 'Describe what to find, e.g. "excavators".';
}

/** The map-pixel geometry of a box plus its class, exactly what a clicked feature's extent and
 * properties carry; `boxFacts` never needs the feature itself. */
export interface BoxGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  classId: string;
}

export interface BoxFacts {
  title: string;
  readout: Readout;
  size: string | null;
}

/** The box popover's lines (spec section 7): class + confidence, the centre readout, and the size
 * in metres when the map has a ground resolution. */
export function boxFacts(
  geoMap: Pick<GeoMap, "geotransform" | "proj4" | "epsg" | "gsd_cm">,
  box: BoxGeom,
  classes: ClassDef[],
  confidence: number,
): BoxFacts {
  const cls = classes.find((c) => c.id === box.classId);
  const title = `${cls?.name ?? "Unknown class"} · ${Math.round(confidence * 100)} %`;
  const readout = makeReadout(geoMap)(box.x + box.w / 2, box.y + box.h / 2);
  const size = geoMap.gsd_cm
    ? `${((box.w * geoMap.gsd_cm) / 100).toFixed(1)} × ${((box.h * geoMap.gsd_cm) / 100).toFixed(1)} m`
    : null;
  return { title, readout, size };
}
