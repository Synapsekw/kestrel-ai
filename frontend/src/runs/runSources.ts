import type { GeoMap, Source } from "@contract/client";

/** Something a run can cover: a photo source, a map source, or a map imported before sources. */
export interface RunSource {
  /** What `RunCreate.source_ids` takes: the source id, or the map id for a map without a source. */
  id: string;
  kind: "images" | "map";
  label: string;
  capturedOn: string | null;
  /** "1 204 photos" or "3.0 cm / px". */
  detail: string;
  /** Map sources: the map's ground size, for the model GSD warning. */
  gsdCm: number | null;
}

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

/** Sources and source-less maps as one list, newest survey first (undated last). */
export function runSources(sources: Source[], maps: GeoMap[]): RunSource[] {
  const byMap = new Map(maps.map((m) => [m.id, m]));
  const owned = new Set(sources.map((s) => s.map_id).filter((id): id is string => !!id));
  const rows: RunSource[] = sources.map((s) => {
    if (s.kind === "map") {
      const m = s.map_id ? byMap.get(s.map_id) : undefined;
      return {
        id: s.id,
        kind: "map",
        label: s.label || m?.name || "Map",
        capturedOn: s.captured_on ?? m?.captured_on ?? null,
        detail: m?.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : "map",
        gsdCm: m?.gsd_cm ?? null,
      };
    }
    return {
      id: s.id,
      kind: "images",
      label: s.label || folderName(s.folder),
      capturedOn: s.captured_on,
      detail: `${fmt(s.image_count)} ${s.image_count === 1 ? "photo" : "photos"}`,
      gsdCm: null,
    };
  });
  for (const m of maps) {
    if (owned.has(m.id) || m.status !== "ready") continue;
    rows.push({
      id: m.id,
      kind: "map",
      label: m.name,
      capturedOn: m.captured_on,
      detail: m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : "map",
      gsdCm: m.gsd_cm,
    });
  }
  return rows.sort((a, b) => (b.capturedOn ?? "").localeCompare(a.capturedOn ?? ""));
}

/** A warning when a map's ground size and the model's training size differ by more than 2x. */
export function gsdWarning(map: RunSource, modelGsd: number | null | undefined): string | null {
  if (!map.gsdCm || !modelGsd) return null;
  const ratio = map.gsdCm / modelGsd;
  if (ratio <= 2 && ratio >= 0.5) return null;
  return `${map.label} is ${map.gsdCm.toFixed(1)} cm / px; the model was trained at ${modelGsd.toFixed(1)} cm / px. Windows are rescaled to the model's size, but counts may be less reliable.`;
}
