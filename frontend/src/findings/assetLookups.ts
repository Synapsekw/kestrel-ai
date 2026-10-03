import type { AssetModel } from "@contract/client";

/** Zone ids are unique per model only; the key carries both. */
export function zoneKey(modelId: string, zoneId: string): string {
  return `${modelId}|${zoneId}`;
}

/** Every model's zone labels (from its resolved review profile), keyed by `zoneKey`. */
export function assetZoneLabels(models: readonly AssetModel[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const m of models) for (const z of m.review?.zones ?? []) out.set(zoneKey(m.id, z.id), z.label);
  return out;
}
