import { useMemo } from "react";
import { create } from "zustand";
import type { Box } from "@contract/client";
import { dur, isReducedMotion } from "@/ui";
import { useWs, wsGet } from "./bridge";
import type { Visibility } from "./suggestions";

/** `held`: the review request is out; the outline stays, still and non-interactive, until it answers. */
export type LeavingKind = "held" | "accept" | "reject";
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
  /** FW's BatchDetectDialog is open: FA's canvas keys stay quiet behind it (M8). */
  batchOpen: boolean;

  openMenu: () => void;
  closeMenu: () => void;
  requestRun: () => void;
  startDetect: (imageId: string, modelName: string) => number;
  endDetect: (token: number) => boolean;
  discardDetect: () => boolean;
  markInFlight: (ids: string[]) => void;
  clearInFlight: (ids: string[]) => void;
  /** `held` items stay until replaced (accept/reject start the fade) or dropped. */
  addLeaving: (items: Leaving[]) => void;
  /** Removes the ghosts still `held` for these ids (a failed or stale review). */
  dropHeld: (ids: string[]) => void;
  setBatchOpen: (open: boolean) => void;
  askConfirm: (c: BulkConfirmState) => void;
  closeConfirm: () => void;
  reset: () => void;
}

/** R-FA4b: accept morph over --dur-base, reject fade over --dur-fast; reduced motion: both fast. */
export function leaveMs(kind: Exclude<LeavingKind, "held">): number {
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
  batchOpen: false,
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
      if (l.kind === "held") continue;
      const kind = l.kind;
      setTimeout(() => {
        set((s) => {
          if (s.leaving[l.box.id] !== l) return s;
          const leaving = { ...s.leaving };
          delete leaving[l.box.id];
          return { leaving };
        });
      }, leaveMs(kind));
    }
  },
  dropHeld: (ids) =>
    set((s) => {
      const held = ids.filter((id) => s.leaving[id]?.kind === "held");
      if (held.length === 0) return s;
      const leaving = { ...s.leaving };
      for (const id of held) delete leaving[id];
      return { leaving };
    }),
  setBatchOpen: (batchOpen) => set({ batchOpen }),
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
