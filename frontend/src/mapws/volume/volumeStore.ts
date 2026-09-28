import { create } from "zustand";

const AUTO_KEY = "kestrel.mapws.autoRecalc";
const HEAT_KEY = "kestrel.mapws.heatmap";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // a blocked storage only loses the preference
  }
}

interface VolumeStore {
  autoRecalc: boolean;
  heatmap: boolean;
  /** A masks sub-tool drawing on the map for the selected measurement. */
  drawing: "stable" | "exclusion" | null;
  setAutoRecalc: (on: boolean) => void;
  setHeatmap: (on: boolean) => void;
  setDrawing: (d: "stable" | "exclusion" | null) => void;
}

export const useVolumeStore = create<VolumeStore>((set) => ({
  autoRecalc: readFlag(AUTO_KEY, true),
  heatmap: readFlag(HEAT_KEY, true),
  drawing: null,
  setAutoRecalc: (on) => {
    writeFlag(AUTO_KEY, on);
    set({ autoRecalc: on });
  },
  setHeatmap: (on) => {
    writeFlag(HEAT_KEY, on);
    set({ heatmap: on });
  },
  setDrawing: (drawing) => set({ drawing }),
}));
