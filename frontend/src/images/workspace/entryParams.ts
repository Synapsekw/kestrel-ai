/**
 * Ruling 4: the redirects' parameters; handled once by the workspace, then dropped. m2: `source`
 * (the old `/query?source=<id>` link) is the flight filter.
 */
export const ENTRY_KEYS = ["filter", "batch", "ids", "source"] as const;
export type Preset = "suggestions" | "unlabeled" | "default";

export interface Entry {
  preset: Preset | null;
  batch: boolean;
  sourceId: string | null;
}

export function parseEntry(q: URLSearchParams): Entry | null {
  if (!ENTRY_KEYS.some((k) => q.has(k))) return null;
  const f = q.get("filter");
  const preset: Preset | null = f === null ? null : f === "suggestions" || f === "unlabeled" ? f : "default";
  return { preset, batch: q.get("batch") === "1", sourceId: q.get("source") || null };
}
