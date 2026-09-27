import type { Placement } from "../layers/placement";
import type { ViewInfo } from "../state/workspaceStore";
import type { SiteExtent } from "../view/siteGrid";
import { clampSwipe, type ClipSide } from "./swipeClip";

export function intersects(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** The bounding extent of a `size` px view at `view` (a rotated view uses its bounding box). */
export function viewExtent(
  view: ViewInfo,
  size: readonly [number, number],
): SiteExtent {
  const hw = (size[0] * view.resolution) / 2;
  const hh = (size[1] * view.resolution) / 2;
  const c = Math.abs(Math.cos(view.rotation));
  const s = Math.abs(Math.sin(view.rotation));
  const ex = hw * c + hh * s;
  const ey = hw * s + hh * c;
  return [
    view.center[0] - ex,
    view.center[1] - ey,
    view.center[0] + ex,
    view.center[1] + ey,
  ];
}

/** The part of an extent one swipe side shows (ruling W2-7). */
export function sideExtent(
  extent: readonly number[],
  pct: number,
  side: ClipSide,
): SiteExtent {
  const x = extent[0] + ((extent[2] - extent[0]) * clampSwipe(pct)) / 100;
  return side === "left"
    ? [extent[0], extent[1], x, extent[3]]
    : [x, extent[1], extent[2], extent[3]];
}

/** Whether a side's own dated placements cover any of `extent`; a missing footprint counts as data. */
export function hasDataIn(
  extent: readonly number[],
  placements: readonly Placement[],
  side: ClipSide,
): boolean {
  return placements.some((p) => {
    if (p.side !== side || p.row.date === null) return false;
    const fp = p.row.layer?.footprint_site ?? null;
    return fp === null || intersects(extent, fp);
  });
}
