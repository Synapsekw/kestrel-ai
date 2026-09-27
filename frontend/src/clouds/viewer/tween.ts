// frontend/src/clouds/viewer/tween.ts
import { cubicBezier, dur, easing } from "@/ui/motion";
import type { View } from "./camera";

/** Spec §7 Views: a 350 ms ease-out tween of position and target. */
export const VIEW_TWEEN_MS = dur.emphasis;

const easeOut = cubicBezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

export interface Tween {
  from: View;
  to: View;
  startedAt: number;
  ms: number;
}

/** Reduced motion makes it a zero-length tween: the engine applies `to` at once. */
export function startTween(from: View, to: View, now: number, reducedMotion: boolean): Tween {
  return { from, to, startedAt: now, ms: reducedMotion ? 0 : VIEW_TWEEN_MS };
}

export function tweenAt(tw: Tween, now: number): { view: View; done: boolean } {
  const t = tw.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - tw.startedAt) / tw.ms));
  if (t >= 1) return { view: tw.to, done: true };
  if (t <= 0) return { view: tw.from, done: false };
  const k = easeOut(t);
  const lerp = (a: View["position"], b: View["position"]) => ({
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
  });
  return {
    view: { position: lerp(tw.from.position, tw.to.position), target: lerp(tw.from.target, tw.to.target) },
    done: false,
  };
}
