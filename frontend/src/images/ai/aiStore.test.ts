import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { leaveMs, useAiStore, useVisibility, visibilityNow } from "./aiStore";
import { wsGet } from "./bridge";
import { resetAll, seedWorkspace, suggestion } from "./testing";

beforeEach(() => {
  resetAll();
  seedWorkspace([]);
});
afterEach(() => vi.useRealTimers());

describe("aiStore", () => {
  it("drops a detection result that Esc discarded, and only the current one", () => {
    const t1 = useAiStore.getState().startDetect("i1", "crack-seg v4");
    expect(useAiStore.getState().detect?.modelName).toBe("crack-seg v4");
    expect(useAiStore.getState().discardDetect()).toBe(true);
    expect(useAiStore.getState().endDetect(t1)).toBe(false);
    const t2 = useAiStore.getState().startDetect("i1", "m");
    expect(useAiStore.getState().endDetect(t2)).toBe(true);
    expect(useAiStore.getState().detect).toBeNull();
    expect(useAiStore.getState().discardDetect()).toBe(false);
  });

  it("removes a leaving ghost after its duration", () => {
    vi.useFakeTimers();
    useAiStore.getState().addLeaving([{ box: suggestion("s1", 0.5), kind: "reject", colour: null }]);
    expect(Object.keys(useAiStore.getState().leaving)).toEqual(["s1"]);
    vi.advanceTimersByTime(leaveMs("reject") + 1);
    expect(useAiStore.getState().leaving).toEqual({});
  });

  it("combines FC's threshold and toggle with FA's in-flight ids, stable between renders", () => {
    const { result, rerender } = renderHook(() => useVisibility());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => wsGet().setThreshold(0.4));
    expect(result.current.threshold).toBe(0.4);
    act(() => useAiStore.getState().markInFlight(["x"]));
    expect(result.current.inFlight.has("x")).toBe(true);
    act(() => wsGet().toggleSuggestions());
    expect(visibilityNow().show).toBe(false);
  });
});
