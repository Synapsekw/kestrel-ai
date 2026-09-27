import type { FindingStatus } from "@/api/findings";
import type { ImageIndexQuery } from "./api";

export type BrowserSort = "capture_time" | "path" | "worst_severity" | "max_pending_confidence";
export type FindingStatusFilter = "all" | FindingStatus;
export type TriState = "all" | "yes" | "no";

/** The left pane's filters (spec §6.1). One value object; `filtersToIndexQuery` is its only reader. */
export interface BrowserFilterState {
  /** "" = every source. */
  sourceId: string;
  hasFindings: boolean;
  findingStatus: FindingStatusFilter;
  /** Selected severity levels; empty = any. Combined with the status on the same finding (§7.1). */
  severities: readonly number[];
  typeIds: readonly string[];
  hasSuggestions: boolean;
  reviewed: TriState;
  unlabeled: boolean;
  search: string;
  sort: BrowserSort;
  order: "asc" | "desc";
}

export const DEFAULT_BROWSER_FILTERS: BrowserFilterState = {
  sourceId: "",
  hasFindings: false,
  findingStatus: "all",
  severities: [],
  typeIds: [],
  hasSuggestions: false,
  reviewed: "all",
  unlabeled: false,
  search: "",
  sort: "capture_time",
  order: "asc",
};

export const SORT_LABEL: Record<BrowserSort, string> = {
  capture_time: "capture time",
  path: "name",
  worst_severity: "worst severity",
  max_pending_confidence: "suggestion confidence",
};

/** Canonical order (severities worst first, type ids sorted), so equal filters give equal queries. */
export function filtersToIndexQuery(f: BrowserFilterState): ImageIndexQuery {
  const q: ImageIndexQuery = { sort: f.sort, order: f.order, fields: "geo" };
  if (f.sourceId) q.source_id = f.sourceId;
  if (f.hasFindings) q.has_findings = true;
  if (f.findingStatus !== "all") q.finding_status = f.findingStatus;
  if (f.severities.length > 0) q.severity = [...f.severities].sort((a, b) => b - a).join(",");
  if (f.typeIds.length > 0) q.type_ids = [...f.typeIds].sort().join(",");
  if (f.hasSuggestions) q.has_suggestions = true;
  if (f.reviewed !== "all") q.reviewed = f.reviewed === "yes";
  if (f.unlabeled) q.unlabeled = true;
  const search = f.search.trim();
  if (search) q.search = search;
  return q;
}

export function toggleSeverity(f: BrowserFilterState, level: number): BrowserFilterState {
  const has = f.severities.includes(level);
  return { ...f, severities: has ? f.severities.filter((l) => l !== level) : [...f.severities, level] };
}

/** Named starting points: `images?filter=suggestions` is where FW redirects the old `/review`. */
const PRESETS: Record<string, Partial<BrowserFilterState>> = {
  suggestions: { hasSuggestions: true, sort: "max_pending_confidence", order: "desc" },
};

export function applyPreset(name: string | null): BrowserFilterState {
  const preset = name ? PRESETS[name] : undefined;
  return { ...DEFAULT_BROWSER_FILTERS, ...(preset ?? {}) };
}

/** How many filters the "More" disclosure hides that differ from the default (its summary). */
export function moreFilterCount(f: BrowserFilterState): number {
  return (
    (f.typeIds.length > 0 ? 1 : 0) +
    (f.hasSuggestions ? 1 : 0) +
    (f.reviewed !== "all" ? 1 : 0) +
    (f.unlabeled ? 1 : 0) +
    (f.search.trim() ? 1 : 0)
  );
}
