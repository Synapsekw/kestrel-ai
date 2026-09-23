import type { GeoMap, Source } from "@contract/client";
import type { RunSummary } from "@/api/sources";

export type SourceKind = "images" | "map";

/** One line of the Sources list: a source, or a map imported before maps had a source. */
export interface SourceRow {
  /** The source id; `map:<id>` for a map without a source. */
  key: string;
  kind: SourceKind;
  /** Null for a map imported before maps had a source: the map row stands in for it. */
  source: Source | null;
  map: GeoMap | null;
  label: string;
  /** The imported folder, or the map file. */
  path: string;
  capturedOn: string | null;
  createdAt: string;
  run: RunSummary | null;
}

const number = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${number(n)} ${n === 1 ? one : many}`;
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** Newest survey first; undated sources after the dated ones, newest import first. */
function byNewestSurvey(a: SourceRow, b: SourceRow): number {
  if (a.capturedOn && b.capturedOn && a.capturedOn !== b.capturedOn)
    return b.capturedOn.localeCompare(a.capturedOn);
  if (a.capturedOn && !b.capturedOn) return -1;
  if (!a.capturedOn && b.capturedOn) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Every source of the project in one list: photo and map sources, and the maps that have no source
 * (imported before maps had one), each with its chosen run.
 */
export function buildRows(sources: Source[], maps: GeoMap[], runs: Map<string, RunSummary>): SourceRow[] {
  const mapById = new Map(maps.map((m) => [m.id, m]));
  const owned = new Set(sources.map((s) => s.map_id).filter((id): id is string => !!id));
  const rows: SourceRow[] = sources.map((s) => {
    const map = s.map_id ? (mapById.get(s.map_id) ?? null) : null;
    return {
      key: s.id,
      kind: s.kind,
      source: s,
      map,
      label: s.label ?? map?.name ?? s.site,
      path: map?.source_path ?? s.folder,
      capturedOn: s.captured_on,
      createdAt: s.created_at,
      run: runs.get(s.id) ?? null,
    };
  });
  for (const m of maps) {
    if (owned.has(m.id)) continue;
    rows.push({
      key: `map:${m.id}`,
      kind: "map",
      source: null,
      map: m,
      label: m.name,
      path: m.source_path,
      capturedOn: m.captured_on,
      createdAt: m.created_at,
      run: null,
    });
  }
  return rows.sort(byNewestSurvey);
}

/**
 * A run in words. A map counts objects; photos count detections, because the same object shows up
 * in several photos.
 */
export function runLine(
  run: RunSummary,
  kind: SourceKind,
): { model: string; counts: string; review: string } {
  const total = sum(run.counts);
  const verified = sum(run.verified_counts);
  const unit = kind === "map" ? ["object", "objects"] : ["detection", "detections"];
  return {
    model: run.model_name ?? "Unnamed model",
    counts: `${plural(total, unit[0], unit[1])} (${number(verified)} verified)`,
    review: `${number(run.review.reviewed)} of ${number(run.review.total)} reviewed`,
  };
}

/** How big a source is: its photos, or the map's pixel size and ground resolution. */
export function sizeLine(source: Source | null, map: GeoMap | null): string {
  if (map) {
    const px = `${number(map.width)} × ${number(map.height)} px`;
    return map.gsd_cm ? `${px} · ${map.gsd_cm.toFixed(1)} cm/px` : px;
  }
  return plural(source?.image_count ?? 0, "photo", "photos");
}
