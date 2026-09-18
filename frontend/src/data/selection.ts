export interface SelectionState {
  selected: ReadonlySet<string>;
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/** Data Manager multi-select: click, Ctrl+click toggles, Shift+click ranges from the anchor. */
export function clickSelect(
  state: SelectionState,
  ids: string[],
  id: string,
  mod: { shift: boolean; ctrl: boolean },
): SelectionState {
  if (mod.shift && state.anchor) {
    const a = ids.indexOf(state.anchor);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = ids.slice(lo, hi + 1);
      return { selected: new Set(mod.ctrl ? [...state.selected, ...range] : range), anchor: state.anchor };
    }
  }
  if (mod.ctrl) return { ...toggleSelect(state, id), anchor: id };
  return { selected: new Set([id]), anchor: id };
}

export function toggleSelect(state: SelectionState, id: string): SelectionState {
  const selected = new Set(state.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, anchor: state.anchor ?? id };
}

export function selectAll(ids: string[]): SelectionState {
  return { selected: new Set(ids), anchor: ids[0] ?? null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** Drop ids that are no longer listed (after a reload or delete). */
export function pruneSelection(state: SelectionState, ids: string[]): SelectionState {
  const keep = new Set(ids);
  const selected = new Set([...state.selected].filter((id) => keep.has(id)));
  if (selected.size === state.selected.size) return state;
  return { selected, anchor: state.anchor && keep.has(state.anchor) ? state.anchor : null };
}
