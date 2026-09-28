import type { CloudMeasurementKind, CloudMeasurementParams } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import {
  AREA_FIELDS,
  FIELDS,
  MeasureRefusal,
  PROFILE_FIELDS,
  RING_FIELDS,
  ringAxis,
  type GPoint,
} from "./measure";

/** The LAZ export's measurements.csv columns, in its order (C-B1 Ruling 10): S1's 27, then the workspace's. */
export const CSV_COLUMNS = [
  "id",
  "name",
  "kind",
  "note",
  "x1",
  "y1",
  "z1",
  "u1",
  "x2",
  "y2",
  "z2",
  "u2",
  ...FIELDS,
  "vertex_count",
  "geometry_wkt",
  ...AREA_FIELDS,
  ...RING_FIELDS,
  ...PROFILE_FIELDS,
] as const;

const NEW_RESULTS = [...AREA_FIELDS, ...RING_FIELDS, ...PROFILE_FIELDS];

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Python's `repr` for a coordinate: an integer keeps its ".0" (the export writes `repr(float)`). */
export function wktNumber(v: number): string {
  return Number.isInteger(v) && Math.abs(v) < 1e16 ? v.toFixed(1) : String(v);
}

const xyz = (p: { x: number; y: number; z: number }) =>
  `${wktNumber(p.x)} ${wktNumber(p.y)} ${wktNumber(p.z)}`;

/** POINT Z, POLYGON Z (closed), or LINESTRING Z; a rings check is the axis between its fitted centres. */
export function geometryWkt(
  kind: CloudMeasurementKind,
  points: readonly GPoint[],
  params: CloudMeasurementParams | null,
): string {
  if (points.length === 0) return "";
  if (kind === "point") return `POINT Z (${xyz(points[0])})`;
  if (kind === "area") return `POLYGON Z ((${[...points, points[0]].map(xyz).join(", ")}))`;
  if (kind === "vertical" && params?.method === "rings") {
    try {
      const [lower, upper] = ringAxis(points);
      return `LINESTRING Z (${xyz(lower)}, ${xyz(upper)})`;
    } catch (e) {
      if (e instanceof MeasureRefusal) return "";
      throw e;
    }
  }
  return `LINESTRING Z (${points.map(xyz).join(", ")})`;
}

/** The same columns as the LAZ export's measurements.csv (spec 2026-09-26-point-cloud-workspace §5, §15). */
export function measurementsCsv(items: CloudMeasurement[]): string {
  const rows = items.map((m) => {
    const pair = m.points.length <= 2 ? m.points : [];
    const p = [...pair, undefined, undefined].slice(0, 2);
    const coords = p.flatMap<number | string>((q) =>
      q ? [q.x, q.y, q.z, q.uncertainty_m] : ["", "", "", ""],
    );
    const res = m.results as Record<string, number | null>;
    return [
      m.id,
      m.name,
      m.kind,
      m.note ?? "",
      ...coords,
      ...FIELDS.map((f) => res[f] ?? ""),
      m.points.length,
      geometryWkt(m.kind, m.points, m.params),
      ...NEW_RESULTS.map((f) => res[f] ?? ""),
    ]
      .map(cell)
      .join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
