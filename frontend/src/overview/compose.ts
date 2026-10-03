/**
 * Spec 2026-09-30-project-landing §5.1: which Overview panes exist and where they sit, from a few
 * facts. A pane with nothing to show is left out and its neighbours close the gap, so the page never
 * shows an empty container. Placement values apply at ≥ lg; below that the grid is one column.
 */
export type HeroKind = "map" | "point_cloud" | "images" | "drawing" | "asset_model";

export interface OverviewFacts {
  heroKind: HeroKind | null;
  dataTotal: number;
  hasCloud: boolean;
  hasImages: boolean;
  hasSite: boolean;
  findingsTotal: number;
  runningJobs: boolean;
}

export type PaneId =
  "header" | "hero" | "cloud" | "location" | "findings" | "imagery" | "status" | "firstData";
export interface Pane {
  id: PaneId;
  col: string;
  row: string;
}
export interface Composition {
  panes: Pane[];
  rows: string;
}

export const ROWS_FULL = "auto minmax(170px,.675fr) minmax(170px,.675fr) minmax(220px,1fr)";
export const ROWS_NO_BOTTOM = "auto minmax(170px,1fr) minmax(170px,1fr)";
const BOTTOM_WEIGHT: Partial<Record<PaneId, number>> = { findings: 5, imagery: 4, status: 3 };

/** Integer column spans in proportion to `weights`, summing to exactly 12. */
function spans(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.round((w * 12) / total));
  out[out.length - 1] = 12 - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

export function composeOverview(f: OverviewFacts): Composition {
  if (f.dataTotal === 0) return { panes: [{ id: "firstData", col: "1 / -1", row: "1 / -1" }], rows: "1fr" };

  const panes: Pane[] = [{ id: "header", col: "1 / -1", row: "1" }];
  const side: PaneId[] = [];
  if (f.hasCloud && f.heroKind !== "point_cloud") side.push("cloud");
  if (f.hasSite) side.push("location");
  panes.push({ id: "hero", col: side.length ? "1 / span 8" : "1 / -1", row: "2 / span 2" });
  side.forEach((id, i) =>
    panes.push({ id, col: "9 / -1", row: side.length === 1 ? "2 / span 2" : String(2 + i) }),
  );

  const bottom: PaneId[] = [];
  if (f.findingsTotal > 0 || f.hasImages) bottom.push("findings");
  if (f.hasImages && f.heroKind !== "images") bottom.push("imagery");
  if (f.findingsTotal > 0 || f.runningJobs) bottom.push("status");
  const widths = spans(bottom.map((id) => BOTTOM_WEIGHT[id] ?? 1));
  let start = 1;
  bottom.forEach((id, i) => {
    panes.push({ id, col: `${start} / span ${widths[i]}`, row: "4" });
    start += widths[i];
  });
  return { panes, rows: bottom.length ? ROWS_FULL : ROWS_NO_BOTTOM };
}
