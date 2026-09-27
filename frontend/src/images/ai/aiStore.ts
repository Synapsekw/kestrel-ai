import { useMemo } from "react";
import { create } from "zustand";
import type { Box } from "@contract/client";
import { dur, isReducedMotion } from "@/ui";
import { useWs, wsGet } from "./bridge";
import type { Visibility } from "./suggestions";

export type LeavingKind = "accept" | "reject";
export interface Leaving {
  box: Box;
  kind: LeavingKind;
  /** The type colour for an accept (the morph's end colour); null draws teal. */
  colour: string | null;
}
export interface DetectRun {
  token: number;
  imageId: string;
  modelName: string;
}
export interface BulkConfirmState {
  action: "accept" | "reject";
  ids: string[];
}

export interface AiState {
  menuOpen: boolean;
  /** Bumped by D while the menu is open: the menu runs the model. */
  runNonce: number;
  detect: DetectRun | null;
  /** Review requests in flight: no longer targets (two fast A presses take two suggestions). */
  inFlight: ReadonlySet<string>;
  leaving: Record<string, Leaving>;
  confirm: BulkConfirmState | null;

  openMenu: () => void;
  closeMenu: () => void;
  requestRun: () => void;
  startDetect: (imageId: string, modelName: string) => number;
  endDetect: (token: number) => boolean;
  discardDetect: () => boolean;
  markInFlight: (ids: string[]) => void;
  clearInFlight: (ids: string[]) => void;
  addLeaving: (items: Leaving[]) => void;
  askConfirm: (c: BulkConfirmState) => void;
  closeConfirm: () => void;
  reset: () => void;
}

/** R-FA4b: accept morph over --dur-base, reject fade over --dur-fast; reduced motion: both fast. */
export function leaveMs(kind: LeavingKind): number {
  return kind === "accept" && !isReducedMotion() ? dur.base : dur.fast;
}

let tokens = 0;
const initial = () => ({
  menuOpen: false,
  runNonce: 0,
  detect: null,
  inFlight: new Set<string>() as ReadonlySet<string>,
  leaving: {},
  confirm: null,
});

export const useAiStore = create<AiState>((set, get) => ({
  ...initial(),
  openMenu: () => set({ menuOpen: true }),
  closeMenu: () => set({ menuOpen: false }),
  requestRun: () => set((s) => ({ runNonce: s.runNonce + 1 })),
  startDetect: (imageId, modelName) => {
    const token = ++tokens;
    set({ detect: { token, imageId, modelName } });
    return token;
  },
  endDetect: (token) => {
    const current = get().detect?.token === token;
    if (current) set({ detect: null });
    return current;
  },
  discardDetect: () => {
    if (!get().detect) return false;
    set({ detect: null });
    return true;
  },
  markInFlight: (ids) => set((s) => ({ inFlight: new Set([...s.inFlight, ...ids]) })),
  clearInFlight: (ids) =>
    set((s) => {
      const next = new Set(s.inFlight);
      for (const id of ids) next.delete(id);
      return { inFlight: next };
    }),
  addLeaving: (items) => {
    set((s) => ({ leaving: { ...s.leaving, ...Object.fromEntries(items.map((l) => [l.box.id, l])) } }));
    for (const l of items) {
      setTimeout(() => {
        set((s) => {
          if (s.leaving[l.box.id] !== l) return s;
          const leaving = { ...s.leaving };
          delete leaving[l.box.id];
          return { leaving };
        });
      }, leaveMs(l.kind));
    }
  },
  askConfirm: (confirm) => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),
  reset: () => set(initial()),
}));

/** FC's threshold and suggestions toggle, FA's in-flight ids; one stable object per change. */
export function useVisibility(): Visibility {
  const threshold = useWs((s) => s.threshold);
  const show = useWs((s) => s.showSuggestions);
  const inFlight = useAiStore((s) => s.inFlight);
  return useMemo(() => ({ threshold, show, inFlight }), [threshold, show, inFlight]);
}

/** The same, read at key time. */
export function visibilityNow(): Visibility {
  const s = wsGet();
  return { threshold: s.threshold, show: s.showSuggestions, inFlight: useAiStore.getState().inFlight };
}
