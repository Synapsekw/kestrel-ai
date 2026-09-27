import type { LayerRow } from "../layers/layerRegistry";
import { orderRows } from "../layers/placement";
import type { ViewInfo } from "../state/workspaceStore";
import type { Coord, WorkspaceLayer } from "../types";
import type { SiteExtent } from "../view/siteGrid";

/** The right date's topmost ortho (shown or not), else the topmost ortho. */
export function pickMinimapRow(
  rows: readonly LayerRow[],
  order: readonly string[] | undefined,
  r: string | null,
  gone: ReadonlySet<string>,
): LayerRow | null {
  const live = orderRows(rows, order).filter((row) => !gone.has(row.key));
  return live.find((row) => row.date === r) ?? live[0] ?? null;
}

const isExtent = (f: readonly number[] | null): f is SiteExtent =>
  f !== null && f.length === 4 && f.every(Number.isFinite);

/** The union of the in-frame footprints (site frame): what "Site overview" fits. */
export function siteExtentOf(layers: readonly WorkspaceLayer[]): SiteExtent | null {
  const fps = layers
    .filter((l) => l.in_frame)
    .map((l) => l.footprint_site)
    .filter(isExtent);
  if (fps.length === 0) return null;
  return [
    Math.min(...fps.map((f) => f[0])),
    Math.min(...fps.map((f) => f[1])),
    Math.max(...fps.map((f) => f[2])),
    Math.max(...fps.map((f) => f[3])),
  ];
}

/** The main view's visible rectangle in site coordinates, rotated with the view, closed. */
export function viewportRing(view: ViewInfo, size: readonly [number, number]): Coord[] {
  const hw = (size[0] * view.resolution) / 2;
  const hh = (size[1] * view.resolution) / 2;
  const cos = Math.cos(view.rotation);
  const sin = Math.sin(view.rotation);
  const corner = (dx: number, dy: number): Coord => [
    view.center[0] + dx * cos - dy * sin,
    view.center[1] + dx * sin + dy * cos,
  ];
  const ring = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
  return [...ring, ring[0]];
}
