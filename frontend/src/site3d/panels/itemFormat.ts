import type { Schemas } from "@contract/client";
import type { AssetItem } from "@/api/plantItems";

export type FlagCode = Schemas["ItemFlagCode"];
export const FLAG_CODES: readonly FlagCode[] = [
  "plan_offset",
  "height_mismatch",
  "missing_in_cloud",
  "unregistered",
  "builder_fallback",
  "straddles_package",
];
/** Plain words for the cloud check's and builders' flags (PRODUCT.md: no jargon). */
export const FLAG_TEXT: Record<FlagCode, string> = {
  plan_offset: "Off its drawn spot in the scan",
  height_mismatch: "Height differs from the scan",
  missing_in_cloud: "Not found in the scan",
  unregistered: "In the scan, not in the register",
  builder_fallback: "Drawn as a simple block",
  straddles_package: "Traced in two work packages",
};
export const HEIGHT_SOURCE: Record<
  "drawing" | "cloud" | "indicative",
  { label: string; tone: "ok" | "info" | "warn" }
> = {
  drawing: { label: "From the drawing", tone: "ok" },
  cloud: { label: "From the scan", tone: "info" },
  indicative: { label: "Indicative", tone: "warn" },
};

export const metres = (v: number | null | undefined) => (v == null ? "not set" : `${v.toFixed(2)} m`);

export function flagText(f: { code: string; value?: number | null; note?: string | null }): string {
  const base = FLAG_TEXT[f.code as FlagCode] ?? f.code;
  const value = f.value != null ? ` (${f.value.toFixed(2)} m)` : "";
  return `${base}${value}${f.note ? `: ${f.note}` : ""}`;
}

/**
 * The footprint's reference point in plant [E, N]: rect/circle centre, polygon/line vertex mean; null
 * when it has neither (no centre and no points), so the UI says "Not set" instead of inventing 0, 0.
 */
export function footprintRef(fp: AssetItem["footprint"]): [number, number] | null {
  const f = fp as { kind: string; center?: number[]; pts?: number[][] };
  if (f.center) return [f.center[0], f.center[1]];
  const pts = f.pts ?? [];
  return pts.length
    ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
    : null;
}
