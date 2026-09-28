import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "./detectModel";
import { lookStyle, tagText } from "./detectionStyle";
import { MAX_CACHED, MAX_HISTORY, useDetectStore } from "./detectStore";

describe("detection styles", () => {
  it("pending defects are accent and dashed; objects take the class colour", () => {
    expect(lookStyle("pending-defect", "#f97316")).toMatchObject({
      stroke: "token:accent",
      dash: [6, 4],
    });
    expect(lookStyle("object", "#f97316")).toMatchObject({
      stroke: "#f97316",
      dash: null,
      label: true,
    });
    expect(lookStyle("object", undefined)?.stroke).toBe("token:accent");
    expect(lookStyle("selected", "#f97316")).toMatchObject({
      stroke: "token:accent",
      width: 3,
    });
    expect(lookStyle("accepted-defect", "#f97316")?.stroke).toBe("token:ok");
    expect(lookStyle("rejected", "#f97316")).toMatchObject({
      stroke: "token:dim",
      dash: [2, 4],
    });
    expect(lookStyle("hidden", "#f97316")).toBeNull();
  });
  it("tags a box with its type and confidence", () => {
    expect(tagText("Excavator", 0.964)).toBe("Excavator 0.96");
    expect(tagText(undefined, 0.5)).toBe("Unknown 0.50");
  });
});

describe("detect store", () => {
  // The store is a module-level singleton; reset it so tests (and other test files that share
  // the same worker) never see a previous test's cache/history/filters.
  beforeEach(() => {
    useDetectStore.setState({
      filters: DEFAULT_FILTERS,
      byId: new Map(),
      inView: {},
      revision: 0,
      history: [],
      outlines: [],
      regionDraft: null,
    });
  });

  it("caps the detection cache", () => {
    const many = Array.from({ length: MAX_CACHED + 5 }, (_, i) => ({ id: `d${i}` }) as never);
    useDetectStore.getState().remember("r1", many);
    expect(useDetectStore.getState().byId.size).toBe(MAX_CACHED);
    expect(useDetectStore.getState().byId.has("d0")).toBe(false);
  });
  it("keeps a back history for Shift+Tab", () => {
    const s = useDetectStore.getState();
    s.pushHistory({ kind: "detection", id: "r.a" });
    s.pushHistory({ kind: "detection", id: "r.b" });
    expect(useDetectStore.getState().popHistory()).toEqual({
      kind: "detection",
      id: "r.a",
    });
  });
  it("does not push a duplicate of the current top of history", () => {
    const s = useDetectStore.getState();
    s.pushHistory({ kind: "detection", id: "r.a" });
    s.pushHistory({ kind: "detection", id: "r.a" });
    expect(useDetectStore.getState().history).toEqual([{ kind: "detection", id: "r.a" }]);
  });
  it("caps the back history at MAX_HISTORY", () => {
    const s = useDetectStore.getState();
    for (let i = 0; i < MAX_HISTORY + 5; i++) s.pushHistory({ kind: "detection", id: `r.${i}` });
    const h = useDetectStore.getState().history;
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h[0]).toEqual({ kind: "detection", id: "r.5" });
    expect(h[h.length - 1]).toEqual({ kind: "detection", id: `r.${MAX_HISTORY + 4}` });
  });
});
