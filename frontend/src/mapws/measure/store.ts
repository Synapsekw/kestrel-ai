import { create } from "zustand";
import type { MapMeasurement } from "@/api/mapMeasurements";
import { profileView } from "./results";

interface MeasurementsState {
  /** The layer's bounded read (≤ 2 000, with `vertices_site`); inspectors re-read their own row. */
  items: MapMeasurement[];
  truncated: boolean;
  set: (items: MapMeasurement[], truncated: boolean) => void;
  /** W3-18: an own PATCH updates the row in place. */
  patch: (id: string, fields: Partial<MapMeasurement>) => void;
  /**
   * M-W3 P6/A14: the inspector's full row (GET `?frame=site`, or a merged PATCH answer) replaces the
   * listed one, or joins the list until the next read. A row without `vertices_site` (a PATCH answer
   * has no frame) keeps the stored geometry.
   */
  upsert: (row: MapMeasurement) => void;
  remove: (id: string) => void;
}

/**
 * A listed profile carries no stations (M-W3 A13); the inspector writes the full row into the store
 * (A14). A list re-read keeps those full results while the row is unchanged (same `updated_at`), so
 * the profile hover does not lose its stations on every revision.
 */
function keepFullProfile(next: MapMeasurement, prev: MapMeasurement | undefined): MapMeasurement {
  if (!prev || next.kind !== "profile" || prev.kind !== "profile") return next;
  if (prev.updated_at !== next.updated_at) return next;
  if (profileView(next).hasData || !profileView(prev).hasData) return next;
  return { ...next, results: prev.results };
}

export const useMeasurementsStore = create<MeasurementsState>((set) => ({
  items: [],
  truncated: false,
  set: (items, truncated) =>
    set((s) => {
      const prev = new Map(s.items.map((m) => [m.id, m]));
      return { items: items.map((m) => keepFullProfile(m, prev.get(m.id))), truncated };
    }),
  patch: (id, fields) =>
    set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, ...fields } : m)),
    })),
  upsert: (row) =>
    set((s) => {
      const prev = s.items.find((m) => m.id === row.id);
      if (!prev) return { items: [...s.items, row] };
      const next = { ...row, vertices_site: row.vertices_site ?? prev.vertices_site };
      return { items: s.items.map((m) => (m.id === row.id ? next : m)) };
    }),
  remove: (id) => set((s) => ({ items: s.items.filter((m) => m.id !== id) })),
}));
