import { useLayoutEffect, useRef } from "react";
import { dur, easing } from "@/ui";

/** For each key present before and after with a different top: where its move must start from. */
export function flipDeltas(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, top] of after) {
    const prev = before.get(key);
    if (prev !== undefined && prev !== top) out.set(key, prev - top);
  }
  return out;
}

/**
 * Ruling 10: when the section order changes, moved sections slide from their old place over
 * --dur-base with --ease-out (Web Animations, no fill, so nothing keeps a transform). Measures
 * after every render so the "before" positions are always the last painted ones.
 */
export function useFlip(root: HTMLElement | null, order: string, reduced: boolean): void {
  const last = useRef<{ order: string; tops: Map<string, number> }>({ order: "", tops: new Map() });
  useLayoutEffect(() => {
    if (!root) return;
    const tops = new Map<string, number>();
    root
      .querySelectorAll<HTMLElement>("[data-section-key]")
      .forEach((el) => tops.set(el.dataset.sectionKey ?? "", el.offsetTop));
    const prev = last.current;
    if (!reduced && prev.order && prev.order !== order) {
      for (const [key, dy] of flipDeltas(prev.tops, tops)) {
        const el = root.querySelector<HTMLElement>(`[data-section-key="${key}"]`);
        el?.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
          duration: dur.base,
          easing: `cubic-bezier(${easing.out.join(",")})`,
        });
      }
    }
    last.current = { order, tops };
  });
}
