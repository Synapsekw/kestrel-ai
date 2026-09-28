import type { MapMeasurement } from "@/api/mapMeasurements";
import type { LayerRow } from "@/mapws/annotations/bindings";
import type { MeasureKind } from "@/mapws/annotations/format";
import { distanceAlong, pointAlong, polylineLength } from "@/mapws/annotations/planar";
import { nearestStation } from "@/mapws/inspect/profileScales";

const KINDS: MeasureKind[] = ["distance", "area", "profile"];

/**
 * The server's chainage (`stations_m`) is ground metres and the drawn line grid metres: both are
 * matched by the fraction along the line (exact on a straight segment; display only).
 */
export function hoverIndexAt(
  line: readonly number[][],
  stations: readonly number[],
  p: readonly number[],
): number {
  const len = polylineLength(line);
  const sMax = stations[stations.length - 1] ?? 0;
  if (len <= 0 || sMax <= 0) return 0;
  return nearestStation(stations, (distanceAlong(line, p) / len) * sMax);
}

export function hoverPoint(
  line: readonly number[][],
  stations: readonly number[],
  index: number,
): [number, number] {
  const len = polylineLength(line);
  const sMax = stations[stations.length - 1] ?? 0;
  if (len <= 0 || sMax <= 0) return pointAlong(line, 0);
  return pointAlong(line, ((stations[index] ?? 0) / sMax) * len);
}

/** The row's live count (spec §5.2 "9 · 3 on this map"); `rMapIds` are the maps of the right date. */
export function measurementsMeta(
  items: readonly Pick<MapMeasurement, "map_id">[],
  truncated: boolean,
  rMapIds: readonly string[],
): string {
  if (truncated) return `${items.length}+`;
  if (items.length === 0) return "None yet";
  const here = items.filter((m) => m.map_id !== null && rMapIds.includes(m.map_id)).length;
  return `${items.length} · ${here} on this map`;
}

/** W3-9: the row style holds the kinds to draw. */
export function measureFilters(style: Readonly<Record<string, unknown>>): {
  kinds: MeasureKind[];
} {
  const raw = style.kinds;
  if (!Array.isArray(raw)) return { kinds: [...KINDS] };
  return { kinds: KINDS.filter((k) => raw.includes(k)) };
}

/** W3-19: one static row (it ignores W1's `LayerRowsContext`); the live count is in the RowExtra. */
export function measurementsRows(): LayerRow[] {
  return [
    {
      key: "measurements:all",
      kind: "measurements",
      group: "annotations",
      id: "all",
      name: "Measurements",
      meta: "Distances, areas and profiles",
      date: null,
    },
  ];
}
