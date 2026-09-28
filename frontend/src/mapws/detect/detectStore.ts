import { create } from "zustand";
import type { MapDetection } from "@/api/mapDetect";
import type { Selection } from "@/mapws/w4host";
import { DEFAULT_FILTERS, type DetectFilters } from "./detectModel";

/** Bounded cache of detections the panes have drawn, oldest evicted first (budget). */
export const MAX_CACHED = 20000;
const MAX_HISTORY = 200;
const same = (a: Selection | undefined, b: Selection) => !!a && a.kind === b.kind && a.id === b.id;

export interface DetectOutline {
  runId: string;
  jobId: string;
  ring: number[][];
}

interface DetectStore {
  filters: DetectFilters;
  setFilters: (p: Partial<DetectFilters>) => void;
  byId: Map<string, { runId: string; d: MapDetection }>;
  remember: (runId: string, ds: MapDetection[]) => void;
  inView: Record<string, string[]>;
  setInView: (runId: string, ids: string[]) => void;
  revision: number;
  refresh: () => void;
  history: Selection[];
  pushHistory: (sel: Selection) => void;
  popHistory: () => Selection | null;
  outlines: DetectOutline[];
  addOutline: (o: DetectOutline) => void;
  dropOutlines: (runIds: string[]) => void;
  regionDraft: number[][] | null;
  setRegionDraft: (ring: number[][] | null) => void;
}

export const useDetectStore = create<DetectStore>((set, get) => ({
  filters: DEFAULT_FILTERS,
  setFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  byId: new Map(),
  remember: (runId, ds) =>
    set((s) => {
      const next = new Map(s.byId);
      for (const d of ds) {
        next.delete(d.id);
        next.set(d.id, { runId, d });
      }
      while (next.size > MAX_CACHED) next.delete(next.keys().next().value as string);
      return { byId: next };
    }),
  inView: {},
  setInView: (runId, ids) => set((s) => ({ inView: { ...s.inView, [runId]: ids } })),
  revision: 0,
  refresh: () => set((s) => ({ revision: s.revision + 1 })),
  history: [],
  pushHistory: (sel) =>
    set((s) =>
      same(s.history[s.history.length - 1], sel) ? s : { history: [...s.history, sel].slice(-MAX_HISTORY) },
    ),
  popHistory: () => {
    const h = get().history;
    if (h.length < 2) return null;
    set({ history: h.slice(0, -1) });
    return h[h.length - 2];
  },
  outlines: [],
  addOutline: (o) => set((s) => ({ outlines: [...s.outlines.filter((x) => x.runId !== o.runId), o] })),
  dropOutlines: (runIds) => set((s) => ({ outlines: s.outlines.filter((o) => !runIds.includes(o.runId)) })),
  regionDraft: null,
  setRegionDraft: (regionDraft) => set({ regionDraft }),
}));
