import { create } from "zustand";
import { toast } from "@/ui";

interface GoneLayers {
  gone: ReadonlySet<string>;
  /**
   * Drops the row for this session and toasts the first time (M §14, W2-9). `silent` is for a layer
   * the operator just deleted: its late tile 404s must not report it as lost.
   */
  markGone: (key: string, name: string, opts?: { silent?: boolean }) => void;
}

export const useGoneLayers = create<GoneLayers>((set, get) => ({
  gone: new Set(),
  markGone: (key, name, opts) => {
    if (get().gone.has(key)) return;
    set({ gone: new Set([...get().gone, key]) });
    if (opts?.silent) return;
    toast("danger", `${name} is no longer available, so it was removed from the map.`);
  },
}));
