import { describe, it, expect } from "vitest";
import {
  clearSelection,
  clickSelect,
  EMPTY_SELECTION,
  pruneSelection,
  selectAll,
  toggleSelect,
} from "./selection";

const ids = ["a", "b", "c", "d"];

describe("selection", () => {
  it("plain click selects one and sets the anchor", () => {
    const s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    expect([...s.selected]).toEqual(["b"]);
    expect(s.anchor).toBe("b");
  });

  it("ctrl click toggles without touching the others", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    s = clickSelect(s, ids, "d", { shift: false, ctrl: true });
    expect([...s.selected].sort()).toEqual(["b", "d"]);
    s = clickSelect(s, ids, "b", { shift: false, ctrl: true });
    expect([...s.selected]).toEqual(["d"]);
  });

  it("shift click selects the range from the anchor, adding with ctrl", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b", { shift: false, ctrl: false });
    s = clickSelect(s, ids, "d", { shift: true, ctrl: false });
    expect([...s.selected]).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
    s = clickSelect(s, ids, "a", { shift: true, ctrl: false });
    expect([...s.selected]).toEqual(["a", "b"]);
    s = clickSelect(s, ids, "d", { shift: true, ctrl: true });
    expect([...s.selected].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("toggle, select all, clear and prune", () => {
    let s = toggleSelect(EMPTY_SELECTION, "c");
    expect([...s.selected]).toEqual(["c"]);
    s = selectAll(ids);
    expect(s.selected.size).toBe(4);
    s = pruneSelection(s, ["a", "c"]);
    expect([...s.selected].sort()).toEqual(["a", "c"]);
    expect(clearSelection().selected.size).toBe(0);
  });
});
