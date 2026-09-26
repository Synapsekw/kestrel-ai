import { useLayoutEffect, type RefObject } from "react";

/** The indicator's CSS width in px (`w-[100px]`); the `scale` mode scales it to the target. */
export const INDICATOR_BASE = 100;

/**
 * Places `indicatorRef` under the element in `listRef` marked `data-indicator-target="true"`.
 * `scale` (Tabs): translateX plus scaleX of a 100 px bar. `width` (Segmented): translateX, and the
 * width snaps. Written straight to the DOM, not to state. Re-measures on resize and once the web fonts
 * have loaded (a width measured with the fallback font is wrong). The first placement never slides:
 * `data-ready`, which enables the transition, is set on the next frame.
 */
export function useSlidingIndicator(
  listRef: RefObject<HTMLElement>,
  indicatorRef: RefObject<HTMLElement>,
  activeKey: string | null | undefined,
  mode: "scale" | "width",
): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    const bar = indicatorRef.current;
    if (!list || !bar) return;
    let live = true;
    const place = () => {
      if (!live) return;
      const target = list.querySelector<HTMLElement>('[data-indicator-target="true"]');
      if (!target) {
        bar.style.opacity = "0";
        return;
      }
      const x = target.offsetLeft;
      const w = target.offsetWidth;
      bar.style.opacity = "1";
      if (mode === "scale") {
        bar.style.transform = `translateX(${x}px) scaleX(${w / INDICATOR_BASE})`;
      } else {
        bar.style.width = `${w}px`;
        bar.style.transform = `translateX(${x}px)`;
      }
    };
    place();
    const frame = requestAnimationFrame(() => {
      bar.dataset.ready = "true";
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(list);
    void document.fonts?.ready.then(place);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [listRef, indicatorRef, activeKey, mode]);
}
