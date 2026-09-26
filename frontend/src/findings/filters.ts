import type { FindingListQuery, FindingStatus } from "@/api/findings";
import { STATUSES } from "./status";

export type SourceKind = "image" | "map" | "cloud";
export type SeverityFilter = number | "none";
export const FINDING_SORTS = ["-severity", "number", "-updated_at", "type"] as const;
export type FindingSort = (typeof FINDING_SORTS)[number];

export interface FindingFilters {
  status: FindingStatus | null;
  severity: SeverityFilter[];
  typeIds: string[];
  source: SourceKind[];
  q: string;
  sort: FindingSort;
}

export const DEFAULT_FILTERS: FindingFilters = {
  status: null,
  severity: [],
  typeIds: [],
  source: [],
  q: "",
  sort: "-severity",
};

const SOURCES: readonly SourceKind[] = ["image", "map", "cloud"];
const MAX_Q = 200;

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

function parseSeverity(v: string): SeverityFilter[] {
  if (v === "none") return ["none"];
  return /^[1-9]\d?$/.test(v) ? [Number(v)] : [];
}

/** The URL uses the API's own parameter names, so a pre-filtered link is also the query. */
export function parseFilters(search: URLSearchParams): FindingFilters {
  const status = search.get("status");
  const sort = search.get("sort");
  return {
    status: STATUSES.includes(status as FindingStatus) ? (status as FindingStatus) : null,
    severity: unique(search.getAll("severity").flatMap(parseSeverity)),
    typeIds: unique(search.getAll("type_id").filter(Boolean)),
    source: unique(
      search.getAll("anchor_kind").filter((s): s is SourceKind => SOURCES.includes(s as SourceKind)),
    ),
    q: (search.get("q") ?? "").slice(0, MAX_Q),
    sort: FINDING_SORTS.includes(sort as FindingSort) ? (sort as FindingSort) : "-severity",
  };
}

export function filtersToSearch(f: FindingFilters): URLSearchParams {
  const s = new URLSearchParams();
  if (f.status) s.set("status", f.status);
  for (const v of f.severity) s.append("severity", String(v));
  for (const v of f.typeIds) s.append("type_id", v);
  for (const v of f.source) s.append("anchor_kind", v);
  if (f.q.trim()) s.set("q", f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort) s.set("sort", f.sort);
  return s;
}

/** F3: the contract's `listFindings` query `severity` is `string[]` — never cast around it. */
export function filtersToQuery(f: FindingFilters): FindingListQuery {
  const q: FindingListQuery = { sort: f.sort };
  if (f.status) q.status = [f.status];
  if (f.severity.length) q.severity = f.severity.map(String);
  if (f.typeIds.length) q.type_id = f.typeIds;
  if (f.source.length) q.anchor_kind = f.source;
  if (f.q.trim()) q.q = f.q.trim();
  return q;
}

/** True when the list is narrowed (sort does not narrow). */
export function isFiltered(f: FindingFilters): boolean {
  return Boolean(f.status || f.severity.length || f.typeIds.length || f.source.length || f.q.trim());
}

/** A link into the Findings tab with these filters (the Overview's "View all" and severity bars). */
export function findingsListPath(projectId: string, partial: Partial<FindingFilters>): string {
  const search = filtersToSearch({ ...DEFAULT_FILTERS, ...partial }).toString();
  return `/p/${projectId}/findings${search ? `?${search}` : ""}`;
}
