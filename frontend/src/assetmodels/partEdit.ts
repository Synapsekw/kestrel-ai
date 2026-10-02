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

/** Display names for spec keys; anything else is its key in sentence case. */
const NAMES: Record<string, string> = {
  id: "Inside diameter",
  od: "Outside diameter",
  dn: "DN",
  d: "Diameter",
  w: "Width",
  l: "Length",
  h: "Height",
  r: "Radius",
  d_bottom: "Bottom diameter",
  d_top: "Top diameter",
  crown_r: "Crown radius",
  knuckle_r: "Knuckle radius",
  flange_od: "Flange OD",
  flange_t: "Flange thickness",
  sweep_deg: "Sweep",
  bearing_deg: "Bearing",
  elevation_mm: "Elevation",
  e_mm: "East",
  n_mm: "North",
};
/** Nominal size, head ratio and plate slope (1:n) carry no unit; the spec has no count params. */
const UNITLESS = new Set(["dn", "ratio", "slope"]);

/** "Inside diameter", "Flange OD", "Projection": the Part tab's field label for a spec key. */
export function paramLabel(key: string): string {
  const plain = key.replace(/_deg$|_mm$/, "").replace(/_/g, " ");
  return NAMES[key] ?? plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** "°" for bearings and sweeps, "" for unitless params, else "mm". */
export function paramUnit(key: string): string {
  return key.endsWith("_deg") ? "°" : UNITLESS.has(key) ? "" : "mm";
}

/** The label mid-sentence: "inside diameter", "flange OD", but "DN" stays as it is. */
function inlineLabel(key: string): string {
  const l = paramLabel(key);
  return /^[A-Z][A-Z]/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1);
}

/** One line of a version note, e.g. "N7: projection 200 → 250 mm" or "N7: bearing 270 → 90°". */
export function editNote(part: AssetPart, key: string, before: number, after: number): string {
  const u = paramUnit(key);
  return `${part.id}: ${inlineLabel(key)} ${before} → ${after}${u === "mm" ? " mm" : u}`;
}
