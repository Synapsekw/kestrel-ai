import { useState } from "react";

interface KeyEventLike {
  key: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * The active option of a listbox driven from a text field (Combobox, CommandPalette). The index goes
 * back to 0 whenever `resetKey` (the query) changes, derived during render rather than set in an
 * effect. ↑ ↓ move and wrap; `move` returns true when it handled (and stopped) the key.
 */
export function useListNavigation(count: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, index: 0 });
  const index = state.key === resetKey ? Math.min(state.index, Math.max(0, count - 1)) : 0;
  const setIndex = (i: number) => setState({ key: resetKey, index: i });
  const move = (e: KeyEventLike): boolean => {
    if (count === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return false;
    e.preventDefault();
    e.stopPropagation();
    setIndex(e.key === "ArrowDown" ? (index + 1) % count : (index - 1 + count) % count);
    return true;
  };
  return { index, setIndex, move };
}
