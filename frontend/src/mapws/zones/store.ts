import { create } from "zustand";
import type { SiteArea } from "@/api/siteAreas";

interface ZonesState {
  /** The last `GET /site-areas?frame=site` (one bounded read). */
  items: SiteArea[];
  /** Bumped after this client's zone writes (there is no site-area event). */
  revision: number;
  set: (items: SiteArea[]) => void;
  bump: () => void;
  /** A PATCH answer has no `polygon_site` (no `frame` on it), so the loaded outline is kept. */
  upsert: (area: SiteArea) => void;
  remove: (id: string) => void;
}

export const useZonesStore = create<ZonesState>((set) => ({
  items: [],
  revision: 0,
  set: (items) => set({ items }),
  bump: () => set((s) => ({ revision: s.revision + 1 })),
  upsert: (area) =>
    set((s) => ({
      items: s.items.some((a) => a.id === area.id)
        ? s.items.map((a) =>
            a.id === area.id ? { ...a, ...area, polygon_site: area.polygon_site ?? a.polygon_site } : a,
          )
        : [...s.items, area],
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((a) => a.id !== id) })),
}));
