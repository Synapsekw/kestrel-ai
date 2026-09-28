import {
  baseMapRows,
  elevationRoleOf,
  elevationRows,
  isShown,
  orderRows,
  surfaceKindOf,
  type CompareMode,
  type MapSide,
  type Survey,
  type WorkspaceLayer,
} from "./bindings";
import { inExtent } from "./planar";

/**
 * The layer W3 picks from: W1's `WorkspaceLayer` row. It reads `kind`, `id`, `date`, `footprint_site`,
 * `surface_kind`, `elevation_role`, `in_frame` and `status`, but it is the whole row (M-W3 P1/P3/P5)
 * because the panel order is W2's `elevationRows`/`baseMapRows`, which take whole rows.
 */
export type PickLayer = WorkspaceLayer;

/**
 * W1's workspace state that decides "visible" and "topmost": the row state and the panel order, plus
 * the session's gone keys (`useGoneLayers`), which the panel drops and W3 never picks (M-W3 P4).
 */
export interface Shown {
  layerState: Readonly<Record<string, { visible: boolean } | undefined>>;
  order: Readonly<Partial<Record<string, readonly string[]>>>;
  gone?: ReadonlySet<string>;
}

export type SeriesRole = "left" | "right" | "design" | "other";
type View = { l: string | null; r: string | null; mode: CompareMode };
type Group = "base" | "elevation";

export const layerKeyOf = (l: Pick<PickLayer, "kind" | "id">) => `${l.kind}:${l.id}`;
const visible = (l: PickLayer, shown: Shown) => isShown(l, shown.layerState);

/** M-W3 P4: in the site frame, ready, and not dropped this session. */
function usable(layers: readonly PickLayer[], shown?: Shown): PickLayer[] {
  return layers.filter((l) => l.in_frame && l.status === "ready" && !shown?.gone?.has(layerKeyOf(l)));
}

export const isDsm = (l: PickLayer) =>
  l.kind === "surface" &&
  (surfaceKindOf(l) === "cloud_dsm" || (surfaceKindOf(l) === "dem" && elevationRoleOf(l) === "dsm"));
export const hasElevation = (layers: readonly PickLayer[]) =>
  usable(layers).some((l) => l.kind === "surface");
export const hasOrtho = (layers: readonly PickLayer[]) => usable(layers).some((l) => l.kind === "map");

/** The group's usable layers as the layers panel shows them, top first (M-W3 P3). */
function panel(layers: readonly PickLayer[], group: Group, shown: Shown): PickLayer[] {
  const ctx = { layers: usable(layers, shown) };
  const rows = group === "base" ? baseMapRows(ctx) : elevationRows(ctx);
  return orderRows(rows, shown.order[group]).flatMap((r) => (r.layer ? [r.layer] : []));
}

export function elevationLayers(layers: readonly PickLayer[], shown: Shown): PickLayer[] {
  return panel(layers, "elevation", shown);
}

/** W3-5: the topmost visible ortho of the right date whose footprint holds the point. */
export function pickAnchorMap(
  layers: readonly PickLayer[],
  shown: Shown,
  rDate: string | null,
  p: readonly number[],
): PickLayer | null {
  if (!rDate) return null;
  return (
    panel(layers, "base", shown).find(
      (l) =>
        l.date === rDate && visible(l, shown) && l.footprint_site !== null && inExtent(p, l.footprint_site),
    ) ?? null
  );
}

/** A date's topmost ortho, visible or not: a measurement's context map (spec §9.1). */
export function mapOfDate(layers: readonly PickLayer[], shown: Shown, date: string | null): PickLayer | null {
  if (!date) return null;
  return panel(layers, "base", shown).find((l) => l.date === date) ?? null;
}

/** W3-7: a date's DSM — visible ones first, a cloud DSM before a dem, then panel order. */
export function pickDsm(layers: readonly PickLayer[], shown: Shown, date: string | null): PickLayer | null {
  if (!date) return null;
  const dsms = elevationLayers(layers, shown).filter((l) => isDsm(l) && l.date === date);
  const seen = dsms.filter((l) => visible(l, shown));
  const pool = seen.length ? seen : dsms;
  return pool.find((l) => surfaceKindOf(l) === "cloud_dsm") ?? pool[0] ?? null;
}

/** W3-6: [l's DSM in compare, the visible design, r's DSM], ≤ 3; else the topmost surface. */
export function pickProfileSurfaces(layers: readonly PickLayer[], shown: Shown, view: View): PickLayer[] {
  const out: PickLayer[] = [];
  if (view.mode !== "single" && view.l && view.l !== view.r) {
    const left = pickDsm(layers, shown, view.l);
    if (left) out.push(left);
  }
  const surfaces = elevationLayers(layers, shown);
  const design = surfaces.find((l) => surfaceKindOf(l) === "design" && visible(l, shown));
  if (design) out.push(design);
  const right = pickDsm(layers, shown, view.r);
  if (right) out.push(right);
  if (out.length === 0) {
    const any = surfaces.find((l) => visible(l, shown)) ?? surfaces[0];
    if (any) out.push(any);
  }
  return out.slice(0, 3);
}

export function seriesRole(surfaceId: string, layers: readonly PickLayer[], view: View): SeriesRole {
  const l = layers.find((x) => x.kind === "surface" && x.id === surfaceId);
  if (!l) return "other";
  if (surfaceKindOf(l) === "design") return "design";
  if (view.r && l.date === view.r) return "right";
  if (view.l && l.date === view.l) return "left";
  return "other";
}

/** W3-13: the maps whose findings one map pane shows under "selected surveys". */
export function findingMapIds(surveys: readonly Survey[], view: View, side: MapSide): string[] {
  const of = (d: string | null) =>
    d ? (surveys.find((s) => s.date === d)?.maps.map((m) => m.id) ?? []) : [];
  if (side === "left") return of(view.l);
  if (side === "right" || view.mode === "single") return of(view.r);
  return [...new Set([...of(view.l), ...of(view.r)])];
}
