import type { CompareMode, MapSide, RowSide } from "../types";
import type { LayerUserState } from "../state/workspaceStore";
import { GROUP_ORDER, type LayerGroup, type LayerKind, type LayerRow } from "./layerRegistry";

export interface Placement {
  row: LayerRow;
  kind: LayerKind;
  map: MapSide;
  side: RowSide;
  zIndex: number;
  /** 0…1. */
  opacity: number;
  style: Record<string, unknown>;
}

export interface PlacementInput {
  rows: readonly LayerRow[];
  state: Record<string, LayerUserState>;
  order: Partial<Record<LayerGroup, string[]>>;
  mode: CompareMode;
  l: string | null;
  r: string | null;
  blend: number;
  kinds: ReadonlyMap<string, LayerKind>;
}

/** One ol/Map, or two sharing one View in Side-by-side (spec M7). */
export function mapsFor(mode: CompareMode): MapSide[] {
  return mode === "side" ? ["left", "right"] : ["single"];
}

/** Display order, top first: rows the operator has not placed yet come first, then `order`. */
export function orderRows(rows: readonly LayerRow[], order: readonly string[] | undefined): LayerRow[] {
  if (!order?.length) return [...rows];
  const at = new Map(order.map((k, i) => [k, i]));
  const known = rows.filter((r) => at.has(r.key)).sort((a, b) => at.get(a.key)! - at.get(b.key)!);
  return [...rows.filter((r) => !at.has(r.key)), ...known];
}

export function effectiveState(
  row: LayerRow,
  kind: LayerKind | undefined,
  state: Record<string, LayerUserState>,
): LayerUserState {
  return state[row.key] ?? { visible: kind?.defaultVisible ?? true, opacity: 100 };
}

const GROUP_STEP = 1000;
const LIFT = 500;

/**
 * Spec §5.2. Groups stack bottom to top (base, elevation, drawings, annotations). Single: every visible
 * row, the r date's dated rows lifted to the top of their group. Swipe and Blend: one map; l's dated rows
 * on the left, r's on the right (lifted; Blend multiplies their opacity by the blend); undated rows on
 * both; a dated row of another date is drawn nowhere and reported in `notInCompare`. Side-by-side: l's
 * rows on the left map, r's on the right, undated rows on both maps.
 */
export function placeLayers(input: PlacementInput): {
  placed: Placement[];
  notInCompare: Set<string>;
} {
  const placed: Placement[] = [];
  const notInCompare = new Set<string>();
  GROUP_ORDER.forEach((group, gi) => {
    const rows = orderRows(
      input.rows.filter((r) => r.group === group && !r.unavailable),
      input.order[group],
    );
    rows.forEach((row, displayIndex) => {
      const kind = input.kinds.get(row.kind);
      if (!kind) return;
      const st = effectiveState(row, kind, input.state);
      if (!st.visible) return;
      const rank = rows.length - 1 - displayIndex;
      const z = (lift: boolean) => gi * GROUP_STEP + (lift ? LIFT : 0) + rank;
      const opacity = st.opacity / 100;
      const style = st.style ?? {};
      if (input.mode === "single") {
        if (kind.Mount)
          placed.push({
            row,
            kind,
            map: "single",
            side: "both",
            zIndex: z(row.date !== null && row.date === input.r),
            opacity,
            style,
          });
        return;
      }
      const side: RowSide | null =
        row.date === null ? "both" : row.date === input.l ? "left" : row.date === input.r ? "right" : null;
      if (side === null) {
        notInCompare.add(row.key);
        return;
      }
      if (!kind.Mount) return;
      if (input.mode === "side") {
        if (side !== "right")
          placed.push({
            row,
            kind,
            map: "left",
            side,
            zIndex: z(false),
            opacity,
            style,
          });
        if (side !== "left")
          placed.push({
            row,
            kind,
            map: "right",
            side,
            zIndex: z(false),
            opacity,
            style,
          });
        return;
      }
      const o = input.mode === "blend" && side === "right" ? opacity * (input.blend / 100) : opacity;
      placed.push({
        row,
        kind,
        map: "single",
        side,
        zIndex: z(side === "right"),
        opacity: o,
        style,
      });
    });
  });
  return { placed, notInCompare };
}
