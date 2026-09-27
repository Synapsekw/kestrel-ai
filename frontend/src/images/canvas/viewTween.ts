import type { ViewTransform } from "./geometry";
import { cubicBezier, easing } from "@/ui/motion";

const ease = cubicBezier(...easing.out);
/** rAF in the app; a 16 ms timer where there is none (jsdom), so fake timers can drive it. */
const frame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function" && !import.meta.env?.VITEST) {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
};

/**
 * Tweens the view from `from` to `to` over `ms` with --ease-out, calling `apply` each frame and
 * once more with `to` exactly. Returns a cancel function; a cancelled tween stops where it is.
 */
export function animateView(
  from: ViewTransform,
  to: ViewTransform,
  ms: number,
  apply: (v: ViewTransform) => void,
): () => void {
  const start = Date.now();
  let cancel: () => void = () => undefined;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const t = Math.min(1, (Date.now() - start) / ms);
    const k = ease(t);
    if (t >= 1) {
      apply(to);
      return;
    }
    // Interpolate the scale geometrically so zooming feels even at every level.
    const scale = from.scale * (to.scale / from.scale) ** k;
    apply({ scale, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    cancel = frame(step);
  };
  cancel = frame(step);
  return () => {
    stopped = true;
    cancel();
  };
}
