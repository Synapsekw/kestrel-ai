import type { SiteFrame } from "../types";
import { siteCode } from "../view/siteFrame";

export type SurfaceStyle = "hillshade" | "tint" | "contours";
export const SURFACE_STYLES: readonly SurfaceStyle[] = ["hillshade", "tint", "contours"];

/** A surface row's `LayerUserState.style`: `{render, interval}`, junk replaced by defaults. */
export function parseRasterStyle(style: Record<string, unknown>): {
  render: SurfaceStyle;
  interval: number | null;
} {
  const render = SURFACE_STYLES.includes(style.render as SurfaceStyle)
    ? (style.render as SurfaceStyle)
    : "hillshade";
  const interval = typeof style.interval === "number" && style.interval > 0 ? style.interval : null;
  return { render, interval };
}

/** A site tile's query extras (M §6): `frame_key` always (W2-12), style and interval for surfaces. */
export function tileExtras(
  kind: "map" | "surface",
  style: Record<string, unknown>,
  frame: SiteFrame,
): Record<string, string> {
  const out: Record<string, string> = { frame_key: siteCode(frame) };
  if (kind !== "surface") return out;
  const s = parseRasterStyle(style);
  out.style = s.render;
  if (s.render === "contours" && s.interval !== null) out.interval = String(s.interval);
  return out;
}
