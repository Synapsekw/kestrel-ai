import type { MeasurementListQuery } from "@/api/measurements";
import type { IconName, PillTone } from "@/ui";

/** The union's providers (M §4 item 8); "all" is the unfiltered view. */
export const KINDS = ["map", "cloud", "volume"] as const;
export type Kind = (typeof KINDS)[number];
export type KindFilter = "all" | Kind;

export interface MeasurementFilters {
  kind: KindFilter;
  /** Only meaningful with a kind; null is "all types". */
  subKind: string | null;
}

export const DEFAULT_FILTERS: MeasurementFilters = {
  kind: "all",
  subKind: null,
};

export const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "map", label: "Maps" },
  { value: "cloud", label: "Point clouds" },
  { value: "volume", label: "Volumes" },
];

/** Sub-kinds this client knows, per kind (M §9.1, C §12 row 1). A volume has one, so no picker. */
const KNOWN_SUB_KINDS: Record<Kind, readonly string[]> = {
  map: ["distance", "area", "profile"],
  cloud: ["point", "distance", "height", "vertical", "area", "profile"],
  volume: [],
};

const KIND_LABEL: Record<string, string> = {
  map: "Map",
  cloud: "Point cloud",
  volume: "Volume",
};
const KIND_ICON: Record<string, IconName> = {
  map: "map",
  cloud: "cloud",
  volume: "volume",
};
const SUB_KIND_LABEL: Record<string, string> = {
  point: "Point",
  distance: "Distance",
  height: "Height",
  vertical: "Verticality",
  area: "Area",
  profile: "Profile",
  volume: "Volume",
};

/** "slope_angle" → "Slope angle": how an unknown value is shown (R-W6-5). */
export function humanise(value: string): string {
  const s = value.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

const isKind = (v: string | null): v is Kind => v !== null && (KINDS as readonly string[]).includes(v);

export function parseFilters(search: URLSearchParams): MeasurementFilters {
  const k = search.get("kind");
  if (!isKind(k)) return DEFAULT_FILTERS;
  return { kind: k, subKind: search.get("sub_kind") || null };
}

export function filtersToSearch(f: MeasurementFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.kind !== "all") {
    out.set("kind", f.kind);
    if (f.subKind) out.set("sub_kind", f.subKind);
  }
  return out;
}

/**
 * Builds the API query (P1): the merged contract's `listMeasurements` takes `kind` and `sub_kind`
 * as arrays, so a single selected kind/sub-kind is sent as a one-element array.
 */
export function filtersToQuery(f: MeasurementFilters): MeasurementListQuery {
  if (f.kind === "all") return {};
  const query: MeasurementListQuery = { kind: [f.kind] };
  // A kind without types (volume) never sends one, so a bogus `?sub_kind=` cannot 422 the list.
  if (f.subKind && subKindOptions(f.kind, null).length > 0) {
    // The sub-kind is a real enum server-side, but the URL (and this filter) may carry an
    // unknown value the client doesn't recognise yet — cast only this string, not the kind.
    query.sub_kind = [f.subKind] as MeasurementListQuery["sub_kind"];
  }
  return query;
}

export function isFiltered(f: MeasurementFilters): boolean {
  return f.kind !== "all";
}

/** The type picker's options: the known sub-kinds of the kind, plus an unknown current one. */
export function subKindOptions(kind: KindFilter, current: string | null): string[] {
  if (kind === "all") return [];
  const known = [...KNOWN_SUB_KINDS[kind]];
  if (known.length === 0) return [];
  return current && !known.includes(current) ? [...known, current] : known;
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? humanise(kind);
}

export function subKindLabel(subKind: string | null | undefined): string {
  if (!subKind) return "";
  return SUB_KIND_LABEL[subKind] ?? humanise(subKind);
}

export function kindIcon(kind: string): IconName {
  return KIND_ICON[kind] ?? "measure";
}

/** "Map · Distance"; a volume's single sub-kind is not repeated. */
export function kindText(m: { kind: string; sub_kind?: string | null }): string {
  const k = kindLabel(m.kind);
  const s = subKindLabel(m.sub_kind);
  return s && s !== k ? `${k} · ${s}` : k;
}

const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** M-C0's `MeasurementUnit` as shown; degrees sit on the number, the rest after a space. */
const UNIT_SUFFIX: Record<string, string> = {
  m: " m",
  m2: " m²",
  m3: " m³",
  deg: "°",
  mm_per_m: " mm/m",
};

/** "1 234.5 m³" (the app's space grouping, as `volumes/model.ts`); "—" when there is no value. */
export function formatHeadline(headline: number | null | undefined, unit: string | null | undefined): string {
  if (typeof headline !== "number" || !Number.isFinite(headline)) return "—";
  const suffix = unit ? (UNIT_SUFFIX[unit] ?? ` ${unit}`) : "";
  return `${nf.format(headline).replace(/,/g, " ")}${suffix}`;
}

export interface StatusView {
  label: string;
  tone: PillTone;
  live: boolean;
}

const STATUS: Record<string, StatusView> = {
  ready: { label: "Ready", tone: "ok", live: false },
  stale: { label: "Stale", tone: "warn", live: false },
  calculating: { label: "Calculating", tone: "accent", live: true },
  computing: { label: "Computing", tone: "accent", live: true },
  failed: { label: "Failed", tone: "danger", live: false },
};

export function statusView(status: string | null | undefined): StatusView {
  if (!status) return { label: "—", tone: "neutral", live: false };
  return STATUS[status] ?? { label: humanise(status), tone: "neutral", live: false };
}
