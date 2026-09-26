import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface RowWindow {
  start: number;
  end: number;
  offsetTop: number;
  totalHeight: number;
}

/** Rows [start, end) to render for a fixed row height, with `overscan` rows above and below. */
export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 4,
): RowWindow {
  const totalHeight = count * rowHeight;
  if (count === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight };
}

export interface VirtualViewport {
  containerRef: RefObject<HTMLDivElement>;
  width: number;
  height: number;
  scrollTop: number;
  onScroll: () => void;
  scrollToIndex: (index: number) => void;
}

/**
 * Scrolling viewport for a fixed-height row virtualiser; the container is the scrolling element
 * (`overflow-auto`). Callers pass `scrollTop` and `height` to `computeWindow`. The size comes only
 * from ResizeObserver callbacks (it delivers an initial notification on `observe`), so no state is
 * set synchronously inside the effect; jsdom has no ResizeObserver and falls back to
 * `fallbackHeight` and width 0.
 */
export function useVirtualRows(opts: { rowHeight: number; fallbackHeight?: number }): VirtualViewport {
  const { rowHeight, fallbackHeight = 600 } = opts;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const height = size.height || fallbackHeight;

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + height) el.scrollTop = bottom - height;
    },
    [rowHeight, height],
  );

  return { containerRef, width: size.width, height, scrollTop, onScroll, scrollToIndex };
}
