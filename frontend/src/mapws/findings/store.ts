import { create } from "zustand";
import type { MapFindingPin } from "@/api/mapFindings";
import type { MapSide } from "@/mapws/annotations/bindings";

interface MapFindingsState {
  /** The last bounded read per map pane (≤ 5 000 each, spec §13). */
  bySide: Partial<Record<MapSide, MapFindingPin[]>>;
  /** The pins in view on any pane (Task 10's `finding.measure` slot reads it). */
  byId: Record<string, MapFindingPin>;
  /** Preflight C: each pane's own answer, so one pane never overwrites the other's flag. */
  truncatedBySide: Partial<Record<MapSide, boolean>>;
  /** Some pane hit the 5 000 cap: the row's count reads "N+". */
  truncated: boolean;
  setSide: (side: MapSide, pins: MapFindingPin[], truncated: boolean) => void;
  /** A pane unmounted (Side-by-side closed): its pins leave `byId`. */
  clearSide: (side: MapSide) => void;
}

function derive(
  bySide: MapFindingsState["bySide"],
  truncatedBySide: MapFindingsState["truncatedBySide"],
): Pick<MapFindingsState, "bySide" | "byId" | "truncatedBySide" | "truncated"> {
  const byId: Record<string, MapFindingPin> = {};
  for (const list of Object.values(bySide)) for (const f of list ?? []) byId[f.id] = f;
  return { bySide, byId, truncatedBySide, truncated: Object.values(truncatedBySide).some(Boolean) };
}

export const useMapFindingsStore = create<MapFindingsState>((set) => ({
  bySide: {},
  byId: {},
  truncatedBySide: {},
  truncated: false,
  setSide: (side, pins, truncated) =>
    set((s) => derive({ ...s.bySide, [side]: pins }, { ...s.truncatedBySide, [side]: truncated })),
  clearSide: (side) =>
    set((s) => {
      if (!(side in s.bySide) && !(side in s.truncatedBySide)) return s;
      const bySide = { ...s.bySide };
      const truncatedBySide = { ...s.truncatedBySide };
      delete bySide[side];
      delete truncatedBySide[side];
      return derive(bySide, truncatedBySide);
    }),
}));
