import type { FindingSummary } from "@/api/findings";
import type { ProjectOverview } from "@/api/overview";
import { findingsListPath } from "@/findings/filters";
import { topLevel } from "@/findings/severity";
import { countLabel } from "@/lib/countLabel";
import type { SeverityLevel } from "@/ui";

export interface Kpi {
  id: "open" | "top" | "data" | "volume" | "reviewed";
  label: string;
  /** F5: `OverviewVolume.net_m3` is nullable; DS `StatTile` shows "—" for a null value. */
  value: number | null;
  unit?: string;
  tone?: "danger";
  delta?: { value: number; good: "up" | "down"; label: string };
  spark?: number[];
  chips?: string[];
  href?: string;
}

export const SPARK_DAYS = 30;
const DAY_MS = 86_400_000;

function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function sortedTrend(s: FindingSummary): FindingSummary["trend"] {
  return [...s.trend].sort((a, b) => a.day.localeCompare(b.day));
}

/** F §9.1's four tiles, from the pre-aggregated payload only. */
export function buildKpis(
  o: ProjectOverview,
  scale: readonly SeverityLevel[],
  projectId: string,
  today: string,
): Kpi[] {
  const s = o.findings;
  const trend = sortedTrend(s);
  const weekAgo = daysBefore(today, 7);

  const openNow = s.by_status.open;
  const past = [...trend].reverse().find((t) => t.day <= weekAgo);
  const openDelta = past ? openNow - past.open : 0;
  const spark = trend.slice(-SPARK_DAYS).map((t) => t.open);
  const open: Kpi = {
    id: "open",
    label: "Open findings",
    value: openNow,
    delta: openDelta ? { value: openDelta, good: "down", label: "vs 7 days ago" } : undefined,
    spark: spark.length >= 2 ? spark : undefined,
    href: findingsListPath(projectId, { status: "open" }),
  };

  const level = topLevel(scale);
  const topCount = level ? (s.open_by_severity[String(level.level)] ?? 0) : 0;
  const closedWeek = trend.filter((t) => t.day > weekAgo).reduce((n, t) => n + t.closed, 0);
  const top: Kpi = {
    id: "top",
    label: level?.name ?? "Highest severity",
    value: topCount,
    tone: topCount > 0 ? "danger" : undefined,
    delta: closedWeek ? { value: -closedWeek, good: "down", label: "closed this week" } : undefined,
    href: level ? findingsListPath(projectId, { status: "open", severity: [level.level] }) : undefined,
  };

  const d = o.data;
  const chips = [
    d.maps ? countLabel(d.maps, "map", "maps") : null,
    d.point_clouds ? countLabel(d.point_clouds, "cloud", "clouds") : null,
    d.elevations ? countLabel(d.elevations, "elevation", "elevations") : null,
    d.drawings ? countLabel(d.drawings, "drawing", "drawings") : null,
  ].filter((c): c is string => c !== null);
  const data: Kpi = {
    id: "data",
    label: "Project data",
    value: d.images,
    unit: d.images === 1 ? "image" : "images",
    chips,
  };

  const v = o.latest_volume;
  if (v) {
    // F5: net_m3 and previous_net_m3 are nullable; never cast around it. The delta is shown only
    // when both volumes are known and the previous one is non-zero.
    const pct =
      v.net_m3 !== null && v.previous_net_m3 !== null && v.previous_net_m3 !== 0
        ? Math.round(((v.net_m3 - v.previous_net_m3) / Math.abs(v.previous_net_m3)) * 1000) / 10
        : null;
    const volume: Kpi = {
      id: "volume",
      label: "Stockpile volume",
      value: v.net_m3 === null ? null : Math.round(v.net_m3),
      unit: "m³",
      delta: pct !== null ? { value: pct, good: "up", label: "% vs previous survey" } : undefined,
    };
    return [open, top, data, volume];
  }
  const total = s.by_status.open + s.by_status.reviewed + s.by_status.closed;
  const reviewed: Kpi = {
    id: "reviewed",
    label: "Reviewed",
    // "Reviewed %" counts reviewed and closed findings over all findings (a closed finding was
    // looked at); F §9.1 says "reviewed / all findings %".
    value: total ? Math.round(((s.by_status.reviewed + s.by_status.closed) / total) * 100) : 0,
    unit: "%",
  };
  return [open, top, data, reviewed];
}

export interface SeverityRow {
  key: string;
  name: string;
  colour: string | null;
  count: number;
  fraction: number;
  href: string;
}

/** One bar per level, highest first, plus "No severity" when any open finding lacks one. */
export function severityRows(
  s: FindingSummary,
  scale: readonly SeverityLevel[],
  projectId: string,
): SeverityRow[] {
  const rows: Omit<SeverityRow, "fraction">[] = [...scale]
    .sort((a, b) => b.level - a.level)
    .map((l) => ({
      key: String(l.level),
      name: l.name,
      colour: l.colour,
      count: s.open_by_severity[String(l.level)] ?? 0,
      href: findingsListPath(projectId, { status: "open", severity: [l.level] }),
    }));
  if (s.open_no_severity > 0)
    rows.push({
      key: "none",
      name: "No severity",
      colour: null,
      count: s.open_no_severity,
      href: findingsListPath(projectId, { status: "open", severity: ["none"] }),
    });
  const max = Math.max(0, ...rows.map((r) => r.count));
  return rows.map((r) => ({ ...r, fraction: max ? r.count / max : 0 }));
}

/** Spec 2026-09-30-project-landing D6: the header shows a figure only when it says something. */
export function headerFigures(kpis: Kpi[]): Kpi[] {
  return kpis.filter((k) => k.value !== null && k.value !== 0);
}

export function formatCoords(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns} ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
