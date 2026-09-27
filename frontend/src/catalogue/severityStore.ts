import { create } from "zustand";
import type { SeverityLevel } from "@/api/catalogue";

interface CatalogueSeverityState {
  /** The catalogue's scale; null until the first answer (DS's default scale shows meanwhile). */
  levels: SeverityLevel[] | null;
  setLevels: (levels: SeverityLevel[]) => void;
}

export const useCatalogueSeverity = create<CatalogueSeverityState>((set) => ({
  levels: null,
  setLevels: (levels) => set({ levels }),
}));
