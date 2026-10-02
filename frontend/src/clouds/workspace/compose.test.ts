import { describe, expect, it, vi } from "vitest";
import { composeFeatures } from "./compose";
import type { WorkspaceTool } from "./types";

const tool = (id: WorkspaceTool["id"]): WorkspaceTool => ({ id, picks: true });

describe("composeFeatures", () => {
  it("merges every feature's slots, in feature order, keyed by feature name", () => {
    const c = composeFeatures([
      {
        name: "measure",
        tools: [tool("distance")],
        measure: { list: "m", detail: null, count: 2 },
        minimap: [{ kind: "line", a: [0, 0], b: [1, 1] }],
      },
      {
        name: "pins",
        tools: [tool("pin")],
        findings: { list: "f", detail: "d", count: 5 },
        layer: "pins",
        floating: "callout",
      },
      { name: "cameras", layersRow: "cams", tools: [tool("photo")] },
      {
        name: "reportViews",
        hintProgress: "Saving views 1 / 3",
        findingsMenu: [{ id: "cap", label: "Capture missing views", onSelect: () => {} }],
      },
    ]);
    expect(c.tools.map((t) => t.id)).toEqual(["distance", "pin", "photo"]);
    expect(c.findings?.count).toBe(5);
    expect(c.findings?.list).toBe("f");
    expect(c.findings?.detail).toBe("d");
    expect(c.measure?.count).toBe(2);
    expect(c.measure?.list).toBe("m");
    expect(c.layers).toEqual([{ key: "pins", node: "pins" }]);
    expect(c.floating).toEqual([{ key: "pins", node: "callout" }]);
    expect(c.layersRows).toEqual([{ key: "cameras", node: "cams" }]);
    expect(c.hintProgress).toBe("Saving views 1 / 3");
    expect(c.findings?.menu?.map((m) => m.id)).toEqual(["cap"]);
    expect(c.minimap).toHaveLength(1);
  });

  it("takes the first feature's findings and measure", () => {
    const c = composeFeatures([
      { name: "a", findings: { list: "first", detail: null } },
      { name: "b", findings: { list: "second", detail: null }, measure: { list: "m1", detail: null } },
      { name: "c", measure: { list: "m2", detail: null } },
    ]);
    expect(c.findings?.list).toBe("first");
    expect(c.measure?.list).toBe("m1");
  });

  it("appends findingsMenu entries after the findings topic's own menu", () => {
    const own = { id: "own", label: "Own", onSelect: () => {} };
    const cap = { id: "cap", label: "Capture missing views", onSelect: () => {} };
    const c = composeFeatures([
      { name: "reportViews", findingsMenu: [cap] },
      { name: "pins", findings: { list: "f", detail: null, menu: [own] } },
    ]);
    expect(c.findings?.menu?.map((m) => m.id)).toEqual(["own", "cap"]);
  });

  it("collects layersRow slots in feature order", () => {
    const c = composeFeatures([
      { name: "a", layersRow: "row a" },
      { name: "b" },
      { name: "c", layersRow: "row c" },
    ]);
    expect(c.layersRows).toEqual([
      { key: "a", node: "row a" },
      { key: "c", node: "row c" },
    ]);
  });

  it("adds nothing for a feature with no topics", () => {
    const c = composeFeatures([{ name: "empty" }]);
    expect(c.findings).toBeNull();
    expect(c.measure).toBeNull();
    expect(c.layersRows).toEqual([]);
  });

  it("keeps the first registration of a tool id and says so", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = composeFeatures([
      { name: "a", tools: [{ ...tool("pin"), commitLabel: "first" }] },
      { name: "b", tools: [{ ...tool("pin"), commitLabel: "second" }] },
    ]);
    expect(c.tools).toHaveLength(1);
    expect(c.tools[0].commitLabel).toBe("first");
    expect(err).toHaveBeenCalledOnce();
  });
});
