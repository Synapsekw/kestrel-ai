import type { AssetPart, AssetSpec } from "@contract/client";

export type FieldValue = number | string | boolean | null;

export function numericParams(part: AssetPart): { key: string; value: number }[] {
  return Object.entries(part.params)
    .filter(([, v]) => typeof v === "number")
    .map(([key, value]) => ({ key, value: value as number }));
}

function mapPart(spec: AssetSpec, partId: string, fn: (p: AssetPart) => AssetPart): AssetSpec {
  return { ...spec, parts: (spec.parts ?? []).map((p) => (p.id === partId ? fn(p) : p)) };
}

export function withParam(spec: AssetSpec, partId: string, key: string, value: number): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, params: { ...p.params, [key]: value } }));
}

export function withPlacement(
  spec: AssetSpec,
  partId: string,
  key: "bearing_deg" | "elevation_mm" | "e_mm" | "n_mm",
  value: number,
): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, placement: { ...(p.placement ?? {}), [key]: value } }));
}

export function withNote(spec: AssetSpec, partId: string, note: string): AssetSpec {
  return mapPart(spec, partId, (p) => ({ ...p, note: note || null }));
}

export function editNote(part: AssetPart, key: string, before: number, after: number): string {
  const deg = key.endsWith("_deg");
  const label = key.replace(/_deg$|_mm$/, "").replace(/_/g, " ");
  return `${part.id}: ${label} ${before} → ${after}${deg ? "°" : " mm"}`;
}
