import type { Layout } from "./routeModel";

export interface TransitionTiming {
  duration: number;
  easing: string;
  keyframes: Keyframe[];
}

/** "180ms" or "0.18s" to milliseconds; a missing or unreadable token gives `fallback`. */
function ms(raw: string, fallback: number): number {
  const v = raw.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return fallback;
}

/**
 * The page entrance (spec 2026-09-26-foundation section 5.5), read from the DS motion tokens so
 * reduced motion (which sets `--dur-base: 0ms`) and the Settings override apply without code here.
 */
export function transitionTiming(
  style: { getPropertyValue(name: string): string },
  layout: Layout,
): TransitionTiming {
  const fullbleed = layout === "fullbleed";
  const easing = style.getPropertyValue(fullbleed ? "--ease-in-out" : "--ease-out").trim();
  return {
    duration: ms(style.getPropertyValue("--dur-base"), 180),
    easing: easing || (fullbleed ? "cubic-bezier(.65,0,.35,1)" : "cubic-bezier(.2,.8,.2,1)"),
    keyframes: fullbleed
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
  };
}
