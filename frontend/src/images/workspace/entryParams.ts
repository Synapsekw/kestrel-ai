/** Ruling 4: the redirects' parameters; handled once by the workspace, then dropped. */
export const ENTRY_KEYS = ["filter", "batch", "ids"] as const;
export type Preset = "suggestions" | "unlabeled" | "default";

export function parseEntry(q: URLSearchParams): { preset: Preset | null; batch: boolean } | null {
  if (!ENTRY_KEYS.some((k) => q.has(k))) return null;
  const f = q.get("filter");
  const preset: Preset | null = f === null ? null : f === "suggestions" || f === "unlabeled" ? f : "default";
  return { preset, batch: q.get("batch") === "1" };
}
