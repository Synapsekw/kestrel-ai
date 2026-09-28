import { create } from "zustand";
import { dur, isReducedMotion } from "@/ui";

/** Spec §9.4 and F §4.2: a new or selected pin pulses once — at most 3 cycles, never a loop. */
export const PULSE_PERIOD_MS = dur.count;
export const PULSE_CYCLES = 3;

export function pulseFrame(elapsedMs: number): { radius: number; alpha: number } | null {
  if (elapsedMs < 0 || elapsedMs >= PULSE_PERIOD_MS * PULSE_CYCLES) return null;
  const t = (elapsedMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  return { radius: 10 + 14 * t, alpha: 1 - t };
}

interface PulseState {
  /** Finding id → start time (performance.now()). */
  started: Record<string, number>;
  pulse: (id: string, now?: number) => void;
  prune: (now: number) => void;
}

export const usePulseStore = create<PulseState>((set) => ({
  started: {},
  pulse: (id, now = performance.now()) => {
    if (isReducedMotion()) return;
    set((s) => ({ started: { ...s.started, [id]: now } }));
  },
  prune: (now) =>
    set((s) => {
      const live = Object.entries(s.started).filter(([, t]) => pulseFrame(now - t) !== null);
      return live.length === Object.keys(s.started).length ? s : { started: Object.fromEntries(live) };
    }),
}));
