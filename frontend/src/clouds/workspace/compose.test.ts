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
        measurementsTab: { body: "m", count: 2 },
        minimap: [{ kind: "line", a: [0, 0], b: [1, 1] }],
      },
      {
        name: "pins",
        tools: [tool("pin")],
        findingsTab: { body: "f", count: 5 },
        layer: "pins",
        floating: "callout",
      },
      { name: "cameras", cloudPanel: "cams", tools: [tool("photo")] },
      {
        name: "reportViews",
        hintProgress: "Saving views 1 / 3",
        findingsMenu: [{ id: "cap", label: "Capture missing views", onSelect: () => {} }],
      },
    ]);
    expect(c.tools.map((t) => t.id)).toEqual(["distance", "pin", "photo"]);
    expect(c.findingsTab?.count).toBe(5);
    expect(c.measurementsTab?.count).toBe(2);
    expect(c.layers).toEqual([{ key: "pins", node: "pins" }]);
    expect(c.floating).toEqual([{ key: "pins", node: "callout" }]);
    expect(c.cloudPanel).toEqual([{ key: "cameras", node: "cams" }]);
    expect(c.hintProgress).toBe("Saving views 1 / 3");
    expect(c.findingsMenu.map((m) => m.id)).toEqual(["cap"]);
    expect(c.minimap).toHaveLength(1);
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
