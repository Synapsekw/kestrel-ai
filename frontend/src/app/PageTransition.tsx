import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { routeInfo } from "./routeModel";
import { transitionTiming } from "./transition";

/**
 * Plays the entrance when the tab (or app sub-section) changes; a change inside a tab does not.
 * No exit animation and no remount: the new page is interactive at once.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { transitionKey, layout } = routeInfo(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const lastKey = useRef(transitionKey);
  useLayoutEffect(() => {
    if (lastKey.current === transitionKey) return;
    lastKey.current = transitionKey;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const t = transitionTiming(getComputedStyle(document.documentElement), layout);
    if (t.duration <= 0) return;
    el.animate(t.keyframes, { duration: t.duration, easing: t.easing });
  }, [transitionKey, layout]);
  return (
    <div ref={ref} data-transition-key={transitionKey} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
