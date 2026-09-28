import { formatSurveyDate } from "@/mapws/annotations/bindings";
import { dedupe, polylineLength, ringArea, ringPerimeter } from "./planar";

export type MeasureKind = "distance" | "area" | "profile";

export const KIND_LABEL: Record<MeasureKind, string> = {
  distance: "Distance",
  area: "Area",
  profile: "Profile",
};

const grouped = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function formatLength(m: number): string {
  if (!Number.isFinite(m)) return "–";
  return Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(2)} m`;
}

export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return "–";
  return Math.abs(m2) >= 1000 ? `${grouped(m2)} m²` : `${m2.toFixed(1)} m²`;
}

export function formatHeight(z: number): string {
  return Number.isFinite(z) ? `${z.toFixed(2)} m` : "–";
}

export function formatScale(k: number): string {
  return Number.isFinite(k) ? k.toFixed(5) : "–";
}

export function formatFraction(f: number): string {
  return `${Math.round(f * 100)}%`;
}

/**
 * "14 Sep 2026" from an ISO date; "date not set" for null (timeline §3.1). Preflight P5: a thin
 * wrapper over W1's `formatSurveyDate` — never a second date formatter.
 */
export function formatDate(iso: string | null): string {
  return formatSurveyDate(iso);
}

/** The label that follows the cursor while drawing: planar, never a stored result (spec M13). */
export function liveLabel(
  kind: MeasureKind,
  coords: readonly number[][],
  frame: "crs" | "local",
): string | null {
  const pts = dedupe(coords);
  const tag = frame === "local" ? "local" : "grid";
  if (kind === "area") {
    if (pts.length < 3) return null;
    return `≈ ${formatArea(ringArea(pts))} · perim ${formatLength(ringPerimeter(pts))} ${tag}`;
  }
  if (pts.length < 2) return null;
  return `≈ ${formatLength(polylineLength(pts))} ${tag}`;
}
