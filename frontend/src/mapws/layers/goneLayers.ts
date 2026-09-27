import { create } from "zustand";
import { toast } from "@/ui";

interface GoneLayers {
  gone: ReadonlySet<string>;
  /** Drops the row for this session and toasts the first time (M §14, W2-9). */
  markGone: (key: string, name: string) => void;
}

export const useGoneLayers = create<GoneLayers>((set, get) => ({
  gone: new Set(),
  markGone: (key, name) => {
    if (get().gone.has(key)) return;
    set({ gone: new Set([...get().gone, key]) });
    toast(
      "danger",
      `${name} is no longer available, so it was removed from the map.`,
    );
  },
}));
