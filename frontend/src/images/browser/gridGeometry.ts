/** Spec §7.2: 3 columns of 4:3 thumbs with a 7 px gap, overscan 3 rows. */
export const GRID_COLS = 3;
export const GRID_GAP = 7;
export const GRID_OVERSCAN = 3;
/** The 280 px pane minus its 12 px padding each side; jsdom and the first render measure 0. */
export const GRID_FALLBACK_WIDTH = 256;
/** Jumps shorter than this many rows scroll smoothly (§7.2). */
const SMOOTH_ROWS = 3;

export interface GridGeometry {
  cols: number;
  cellW: number;
  cellH: number;
  rowH: number;
}

export function gridGeometry(width: number): GridGeometry {
  const w = width > 0 ? width : GRID_FALLBACK_WIDTH;
  const cellW = (w - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellH = (cellW * 3) / 4;
  return { cols: GRID_COLS, cellW, cellH, rowH: cellH + GRID_GAP };
}

/** Where to scroll so `ordinal`'s row is visible; null when it already is. */
export function scrollTargetFor(
  ordinal: number,
  rowH: number,
  cols: number,
  scrollTop: number,
  viewportH: number,
): { top: number; smooth: boolean } | null {
  const row = Math.floor(ordinal / cols);
  const top = row * rowH;
  const bottom = top + rowH;
  let target: number;
  if (top < scrollTop) target = top;
  else if (bottom > scrollTop + viewportH) target = bottom - viewportH;
  else return null;
  const firstRow = Math.floor(scrollTop / rowH);
  const lastRow = Math.floor((scrollTop + viewportH) / rowH);
  const distance = row < firstRow ? firstRow - row : row - lastRow;
  return { top: target, smooth: distance < SMOOTH_ROWS };
}

/** "205–222 of 312": 1-based ordinals of the rows in view. */
export function visibleRange(
  scrollTop: number,
  viewportH: number,
  rowH: number,
  cols: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const firstRow = Math.floor(Math.max(0, scrollTop) / rowH);
  const lastRow = Math.ceil((Math.max(0, scrollTop) + viewportH) / rowH);
  return { from: Math.min(total, firstRow * cols + 1), to: Math.min(total, lastRow * cols) };
}
