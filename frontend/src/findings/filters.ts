import type { FindingListQuery, FindingStatus } from "@/api/findings";
import { STATUSES } from "./status";

export type SourceKind = "image" | "map" | "cloud" | "asset";
export type SeverityFilter = number | "none";
export const FINDING_SORTS = ["-severity", "number", "-updated_at", "type", "-height", "zone"] as const;
export type FindingSort = (typeof FINDING_SORTS)[number];
/** `placed=true|false` in the URL and the API; "all" sends nothing. */
export type PlacedFilter = "all" | "placed" | "unplaced";
/** Written to the URL so a link keeps it; never sent to the API. */
export type FindingView = "table" | "gallery";

export interface FindingFilters {
  status: FindingStatus | null;
  severity: SeverityFilter[];
  typeIds: string[];
  source: SourceKind[];
  q: string;
  sort: FindingSort;
  assetModelId: string | null;
  zone: string[];
  side: string[];
  placed: PlacedFilter;
  view: FindingView;
}

export const DEFAULT_FILTERS: FindingFilters = {
  status: null,
  severity: [],
  typeIds: [],
  source: [],
  q: "",
  sort: "-severity",
  assetModelId: null,
  zone: [],
  side: [],
  placed: "all",
  view: "table",
};

const SOURCES: readonly SourceKind[] = ["image", "map", "cloud", "asset"];
const MAX_Q = 200;
/** Zone ids, side labels and model ids are short; a longer value is a malformed link. */
const MAX_KEY = 120;

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const keys = (xs: string[]): string[] => unique(xs.filter((v) => v && v.length <= MAX_KEY));

function parseSeverity(v: string): SeverityFilter[] {
  if (v === "none") return ["none"];
  return /^[1-9]\d?$/.test(v) ? [Number(v)] : [];
}

function parsePlaced(v: string | null): PlacedFilter {
  if (v === "true") return "placed";
  if (v === "false") return "unplaced";
  return "all";
}

/** The URL uses the API's own parameter names, so a pre-filtered link is also the query. */
export function parseFilters(search: URLSearchParams): FindingFilters {
  const status = search.get("status");
  const sort = search.get("sort");
  const model = search.get("asset_model_id");
  return {
    status: STATUSES.includes(status as FindingStatus) ? (status as FindingStatus) : null,
    severity: unique(search.getAll("severity").flatMap(parseSeverity)),
    typeIds: unique(search.getAll("type_id").filter(Boolean)),
    source: unique(
      search.getAll("anchor_kind").filter((s): s is SourceKind => SOURCES.includes(s as SourceKind)),
    ),
    q: (search.get("q") ?? "").slice(0, MAX_Q),
    sort: FINDING_SORTS.includes(sort as FindingSort) ? (sort as FindingSort) : "-severity",
    assetModelId: model && model.length <= MAX_KEY ? model : null,
    zone: keys(search.getAll("zone")),
    side: keys(search.getAll("side")),
    placed: parsePlaced(search.get("placed")),
    view: search.get("view") === "gallery" ? "gallery" : "table",
  };
}

export function filtersToSearch(f: FindingFilters): URLSearchParams {
  const s = new URLSearchParams();
  if (f.status) s.set("status", f.status);
  for (const v of f.severity) s.append("severity", String(v));
  for (const v of f.typeIds) s.append("type_id", v);
  for (const v of f.source) s.append("anchor_kind", v);
  if (f.assetModelId) s.set("asset_model_id", f.assetModelId);
  for (const v of f.zone) s.append("zone", v);
  for (const v of f.side) s.append("side", v);
  if (f.placed !== "all") s.set("placed", f.placed === "placed" ? "true" : "false");
  if (f.q.trim()) s.set("q", f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort) s.set("sort", f.sort);
  if (f.view !== DEFAULT_FILTERS.view) s.set("view", f.view);
  return s;
}

/** F3: the contract's `listFindings` query `severity` is `string[]`; never cast around it. */
export function filtersToQuery(f: FindingFilters): FindingListQuery {
  const q: FindingListQuery = { sort: f.sort };
  if (f.status) q.status = [f.status];
  if (f.severity.length) q.severity = f.severity.map(String);
  if (f.typeIds.length) q.type_id = f.typeIds;
  if (f.source.length) q.anchor_kind = f.source;
  if (f.assetModelId) q.asset_model_id = f.assetModelId;
  if (f.zone.length) q.zone = f.zone;
  if (f.side.length) q.side = f.side;
  if (f.placed !== "all") q.placed = f.placed === "placed";
  if (f.q.trim()) q.q = f.q.trim();
  return q;
}

/** True when the list is narrowed (sort and view do not narrow). */
export function isFiltered(f: FindingFilters): boolean {
  return Boolean(
    f.status ||
    f.severity.length ||
    f.typeIds.length ||
    f.source.length ||
    f.q.trim() ||
    f.assetModelId ||
    f.zone.length ||
    f.side.length ||
    f.placed !== "all",
  );
}

/** "Clear filters": every filter back to its default, the sort and the view kept. */
export function clearedFilters(f: FindingFilters): FindingFilters {
  return { ...DEFAULT_FILTERS, sort: f.sort, view: f.view };
}

/** A link into the Findings tab with these filters (the Overview's "View all" and severity bars). */
export function findingsListPath(projectId: string, partial: Partial<FindingFilters>): string {
  const search = filtersToSearch({ ...DEFAULT_FILTERS, ...partial }).toString();
  return `/p/${projectId}/findings${search ? `?${search}` : ""}`;
}
