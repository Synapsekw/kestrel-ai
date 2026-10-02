import type { MapDetection } from "@/api/mapDetect";
import type { MapFindingPin } from "@/api/mapFindings";
import type { MapMeasurement } from "@/api/mapMeasurements";
import type { SiteArea } from "@/api/siteAreas";
import { formatFindingNumber } from "@/findings/format";
import type { TopicItem } from "@/ui";
import { detectionSelection, isPending, lookOf, type DetectFilters } from "../detect/detectModel";
import { visibleFindings, type FindingFilterValues } from "../findings/tooltip";
import type { SiteExtent } from "../view/siteGrid";

/** Topic list rows (spec §2 "List"); ids are `<selection kind>:<id>` so one list can mix kinds. */
export function findingItems(
  pins: readonly MapFindingPin[],
  filters: FindingFilterValues,
  typeName: (id: string) => string | undefined,
): TopicItem[] {
  return visibleFindings(pins, filters)
    .slice()
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.number - b.number)
    .map((f) => ({
      id: `finding:${f.id}`,
      label: typeName(f.type_id) ?? "Finding",
      meta: formatFindingNumber(f.number),
    }));
}

export function zoneItems(areas: readonly SiteArea[]): TopicItem[] {
  return areas.map((a) => ({ id: `zone:${a.id}`, label: a.name }));
}

export function measurementItems(items: readonly MapMeasurement[], kinds: readonly string[]): TopicItem[] {
  return items
    .filter((m) => kinds.includes(m.kind))
    .map((m) => ({ id: `measurement:${m.id}`, label: m.name }));
}

/** The bounding box of site coordinates; null for none. */
export function extentOf(coords: readonly (readonly number[])[]): SiteExtent | null {
  if (coords.length === 0) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** A finding pin's site coordinates: its point, or its outline's outer ring. */
export function findingCoords(pin: MapFindingPin): number[][] {
  const g = pin.geometry_site;
  return g.type === "Point" ? [g.coordinates] : (g.coordinates[0] ?? []);
}

/**
 * The AI review queue (spec §3.1): the detections the panes drew, filtered as the stage draws them,
 * pending first. Ids are `detection:<runId>.<detectionId>`, the detection Selection's id.
 */
export function detectionItems(
  inView: Readonly<Record<string, readonly string[]>>,
  byId: ReadonlyMap<string, { runId: string; d: MapDetection }>,
  filters: DetectFilters,
  typeOf: (classId: string) => { name: string; kind: string } | undefined,
): TopicItem[] {
  const pending: TopicItem[] = [];
  const rest: TopicItem[] = [];
  for (const [runId, ids] of Object.entries(inView)) {
    for (const id of ids) {
      const hit = byId.get(id);
      if (!hit || hit.runId !== runId) continue;
      const type = typeOf(hit.d.class_id);
      const kind = type?.kind === "defect" || type?.kind === "object" ? type.kind : undefined;
      if (lookOf(hit.d, kind, filters, false) === "hidden") continue;
      const sel = detectionSelection(runId, hit.d.id);
      (isPending(hit.d) ? pending : rest).push({
        id: `${sel.kind}:${sel.id}`,
        label: type?.name ?? "Detection",
        meta: `${Math.round(hit.d.confidence * 100)} %`,
      });
    }
  }
  return [...pending, ...rest];
}
