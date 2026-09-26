import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { FIELDS } from "./measure";

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
] as const;

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The same columns as the LAZ export's measurements.csv (spec §11). */
export function measurementsCsv(items: CloudMeasurement[]): string {
  const rows = items.map((m) => {
    const p = [...m.points, undefined, undefined].slice(0, 2);
    const coords = p.flatMap<number | string>((q) =>
      q ? [q.x, q.y, q.z, q.uncertainty_m] : ["", "", "", ""],
    );
    const res = m.results as Record<string, number | null>;
    return [m.id, m.name, m.kind, m.note ?? "", ...coords, ...FIELDS.map((f) => res[f] ?? "")]
      .map(cell)
      .join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
