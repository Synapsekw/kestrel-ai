import { useSyncExternalStore, type CSSProperties } from "react";

/** Durations in ms, mirroring `--dur-*` in index.css (motion.test.tsx keeps them equal). */
export const dur = { instant: 0, fast: 120, base: 180, slow: 260, emphasis: 350, count: 600 } as const;

/** Control points mirroring `--ease-out`, `--ease-spring` and `--ease-in-out`. */
export const easing = {
  out: [0.2, 0.8, 0.2, 1],
  spring: [0.3, 1.6, 0.5, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** `--stagger-step` (ms) and `--stagger-max` (items). */
export const staggerTokens = { step: 40, max: 8 } as const;

/** The `--i` index for `.stagger` (ui.css). The CSS caps it, so pass the plain index. */
export function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/** A CSS cubic-bezier timing function for JavaScript animation (count-up). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return sampleY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (hi - lo > 1e-6) {
      if (sampleX(s) < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

const QUERY = "(prefers-reduced-motion: reduce)";
const KEY = "kestrel.motion";

export type MotionChoice = "system" | "reduce";

export function readMotionChoice(): MotionChoice {
  try {
    return localStorage.getItem(KEY) === "reduce" ? "reduce" : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Sets or clears `<html data-motion="reduced">`. main.tsx calls it once with the saved choice. */
export function applyMotion(choice: MotionChoice = readMotionChoice()): void {
  if (choice === "reduce") document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
  notify();
}

/** Settings → Appearance → Reduce motion (S2). A blocked store keeps the choice for this session. */
export function setMotionChoice(choice: MotionChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice applies until the app restarts.
  }
  applyMotion(choice);
}

function mediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
}

export function isReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced" || (mediaQuery()?.matches ?? false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const mq = mediaQuery();
  mq?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener?.("change", listener);
  };
}

/** True when the OS asks for reduced motion or Settings → Reduce motion is on. Feeds JS animation. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false);
}
