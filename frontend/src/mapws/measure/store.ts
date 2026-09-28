import { create } from "zustand";
import type { MapMeasurement } from "@/api/mapMeasurements";

interface MeasurementsState {
  /** The layer's bounded read (≤ 2 000, with `vertices_site`); inspectors re-read their own row. */
  items: MapMeasurement[];
  truncated: boolean;
  set: (items: MapMeasurement[], truncated: boolean) => void;
  /** W3-18: an own PATCH updates the row in place. */
  patch: (id: string, fields: Partial<MapMeasurement>) => void;
  remove: (id: string) => void;
}

export const useMeasurementsStore = create<MeasurementsState>((set) => ({
  items: [],
  truncated: false,
  set: (items, truncated) => set({ items, truncated }),
  patch: (id, fields) =>
    set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, ...fields } : m)),
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((m) => m.id !== id) })),
}));
