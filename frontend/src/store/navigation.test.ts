import { describe, it, expect, beforeEach } from "vitest";
import { useNavigationStore } from "./navigation";

describe("navigation store", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("walks the context in order", () => {
    useNavigationStore.getState().setContext(["a", "b", "c"], "data");
    const n = useNavigationStore.getState().neighbours;
    expect(n("a")).toEqual({ prev: null, next: "b", index: 0, count: 3 });
    expect(n("b")).toEqual({ prev: "a", next: "c", index: 1, count: 3 });
    expect(n("c")).toEqual({ prev: "b", next: null, index: 2, count: 3 });
    expect(n("zz")).toEqual({ prev: null, next: null, index: -1, count: 3 });
    expect(useNavigationStore.getState().source).toBe("data");
  });
});
