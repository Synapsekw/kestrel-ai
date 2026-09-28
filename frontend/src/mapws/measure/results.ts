import type {
  MapAreaResults,
  MapDistanceResults,
  MapMeasurement,
  MapProfileResults,
} from "@/api/mapMeasurements";
import { KIND_LABEL, formatArea, formatLength } from "@/mapws/annotations/format";

type Row = Pick<MapMeasurement, "kind" | "epsg" | "crs_wkt" | "results" | "vertices_site">;

/** A measurement's results, narrowed on its `kind` (M-W3 P7) — never on which keys are present. */
export type KindResults =
  | { kind: "distance"; results: MapDistanceResults }
  | { kind: "area"; results: MapAreaResults }
  | { kind: "profile"; results: MapProfileResults };

/**
 * The contract types `results` as the union of the three shapes; the server writes the shape of the
 * row's `kind` (M-C0), so the kind decides which one this is.
 */
export function resultsOf(m: Pick<MapMeasurement, "kind" | "results">): KindResults {
  switch (m.kind) {
    case "distance":
      return { kind: "distance", results: m.results as MapDistanceResults };
    case "area":
      return { kind: "area", results: m.results as MapAreaResults };
    case "profile":
      return { kind: "profile", results: m.results as MapProfileResults };
  }
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Drawn in a local-metres frame: no CRS, so grid values only (spec §9.1, §14). */
export function isLocal(m: Pick<Row, "epsg" | "crs_wkt">): boolean {
  return (m.epsg ?? null) === null && !m.crs_wkt;
}

export function crsText(m: Pick<Row, "epsg" | "crs_wkt">): string {
  if (isLocal(m)) return "Local metres";
  return m.epsg ? `EPSG:${m.epsg}` : "Custom CRS";
}

/**
 * The vertices in the current site frame (`?frame=site`); an area ring is open (M-C0). Only
 * `vertices_site` is the site frame — `vertices` is the stored frame — so a row without it has no
 * site coordinates and callers skip it (M-W3 P6).
 */
export function siteCoords(m: Pick<Row, "vertices_site">): number[][] {
  return (m.vertices_site ?? []).map((v) => [v[0], v[1]]);
}

export const vertexCount = (m: Pick<Row, "vertices_site">) => siteCoords(m).length;

export interface DistanceView {
  length: number | null;
  basis: "ellipsoidal" | "local";
  grid: number | null;
  scale: number | null;
  length3d: number | null;
  nodata: number | null;
}

export function distanceView(m: Pick<Row, "kind" | "results" | "epsg" | "crs_wkt">): DistanceView {
  const local = isLocal(m);
  const k = resultsOf(m);
  const r = k.kind === "distance" ? k.results : null;
  return {
    length: local ? num(r?.grid_length_m) : num(r?.length_m),
    basis: local ? "local" : "ellipsoidal",
    grid: local ? null : num(r?.grid_length_m),
    scale: local ? null : num(r?.scale_factor),
    length3d: num(r?.length_3d_m),
    nodata: num(r?.nodata_fraction),
  };
}

export interface AreaView {
  area: number | null;
  basis: "ellipsoidal" | "local";
  perimeter: number | null;
  grid: number | null;
  scale: number | null;
}

export function areaView(m: Pick<Row, "kind" | "results" | "epsg" | "crs_wkt">): AreaView {
  const local = isLocal(m);
  const k = resultsOf(m);
  const r = k.kind === "area" ? k.results : null;
  return {
    area: local ? num(r?.grid_area_m2) : num(r?.area_m2),
    basis: local ? "local" : "ellipsoidal",
    perimeter: local ? num(r?.grid_perimeter_m) : num(r?.perimeter_m),
    grid: local ? null : num(r?.grid_area_m2),
    scale: local ? null : num(r?.areal_scale_factor),
  };
}

export interface ProfileSeries {
  surfaceId: string;
  label: string;
  date: string | null;
  z: (number | null)[];
}

export interface ProfileView {
  /** False for a listed row (`stations_m: []`, `series: []`): no profile data yet — re-read the row. */
  hasData: boolean;
  stations: number[];
  series: ProfileSeries[];
  zMin: number | null;
  zMax: number | null;
  cut: number | null;
  fill: number | null;
  nodata: number | null;
}

type SeriesRow = MapProfileResults["series"][number];

/** A series the server wrote whole; anything else is dropped rather than drawn. */
const isSeries = (s: unknown): s is SeriesRow =>
  typeof s === "object" &&
  s !== null &&
  typeof (s as SeriesRow).surface_id === "string" &&
  Array.isArray((s as SeriesRow).z);

/** Spec §9.2 results; a NaN height travels as null and stays null (a gap in the chart). */
export function profileView(m: Pick<Row, "kind" | "results">): ProfileView {
  const k = resultsOf(m);
  const r = k.kind === "profile" ? k.results : null;
  const rawStations: readonly unknown[] = Array.isArray(r?.stations_m) ? r.stations_m : [];
  const rawSeries: readonly unknown[] = Array.isArray(r?.series) ? r.series : [];
  const stations = rawStations.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN));
  const series: ProfileSeries[] = rawSeries.filter(isSeries).map((s) => ({
    surfaceId: s.surface_id,
    label: typeof s.label === "string" ? s.label : "Surface",
    date: typeof s.date === "string" ? s.date : null,
    z: s.z.map((v) => num(v)),
  }));
  const hasData = stations.length > 0 && series.length > 0;
  return {
    hasData,
    stations: hasData ? stations : [],
    series: hasData ? series : [],
    zMin: num(r?.z_min),
    zMax: num(r?.z_max),
    cut: num(r?.cut_area_m2),
    fill: num(r?.fill_area_m2),
    nodata: num(r?.nodata_fraction),
  };
}

/** The label drawn on the map next to a measurement. */
export function headline(m: Row): string {
  const k = resultsOf(m);
  switch (k.kind) {
    case "distance":
      return formatLength(distanceView(m).length ?? Number.NaN);
    case "area":
      return formatArea(areaView(m).area ?? Number.NaN);
    case "profile": {
      // A13: listed rows carry no stations, so the length comes from the stored results.
      const length = num(k.results.length_m) ?? num(k.results.grid_length_m);
      return `${KIND_LABEL.profile} · ${formatLength(length ?? Number.NaN)}`;
    }
  }
}
