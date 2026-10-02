import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/mapws/plugins";
import { useWorkspace } from "../context";
import { layerRegistry, type LayerRowsContext } from "../layers/layerRegistry";
import { makeStores, renderHookInWorkspace } from "../test/harness";
import { UTM33, layer } from "../test/fixtures";
import type { ToolContext } from "../tools/toolStore";
import { useMapRail } from "./useMapRail";

afterEach(() => localStorage.clear());

function renderMapRail({ hasBaseData = true }: { hasBaseData?: boolean } = {}) {
  const stores = makeStores();
  const layers = [layer("map", "m1", { date: "2026-09-14" })];
  const ctx: LayerRowsContext = {
    projectId: "p",
    frame: UTM33,
    layers,
    surveys: stores.workspace.getState().surveys,
  };
  const rows = layerRegistry.all().flatMap((k) => k.rows(ctx));
  const notInCompare = new Set<string>();
  const { result } = renderHookInWorkspace(
    () => {
      const selection = useWorkspace((s) => s.selection);
      const surveys = useWorkspace((s) => s.surveys);
      const r = useWorkspace((s) => s.r);
      const context: ToolContext = { frame: UTM33, selection, surveys, layers, r };
      return useMapRail({ rows, notInCompare, projectId: "p", context, hasBaseData });
    },
    { stores },
  );
  return { tools: stores.tools, workspace: stores.workspace, rail: result.current.store, result };
}

describe("useMapRail", () => {
  it("arming a tool follows its topic only while the panel is open", () => {
    const { tools, rail } = renderMapRail();
    act(() => tools.getState().activate("distance"));
    expect(rail.getState().topic).toBe("measure");
    act(() => rail.getState().close());
    act(() => tools.getState().activate("finding-point"));
    expect(rail.getState()).toMatchObject({ open: false, topic: "measure" });
  });

  it("switching topic keeps a draft in progress", () => {
    const { tools, rail } = renderMapRail();
    act(() => tools.getState().activate("area"));
    act(() => tools.getState().addVertex([0, 0]));
    act(() => rail.getState().openTopic("layers"));
    expect(tools.getState().draft).toHaveLength(1);
  });

  it("a key for a tool of a hidden topic turns the topic back on", () => {
    const { tools, workspace } = renderMapRail();
    // The topic is hidden when its eye is off: findings and zones both (spec §4 "Eye").
    act(() => {
      workspace.getState().setLayerState("findings:all", { visible: false });
      workspace.getState().setLayerState("zones:all", { visible: false });
    });
    act(() => tools.getState().activate("finding-point"));
    expect(workspace.getState().layerState["findings:all"]?.visible).toBe(true);
  });

  it("a tool key shows its topic's hidden row even while another row keeps the eye on (R7)", () => {
    const { tools, workspace } = renderMapRail();
    act(() => workspace.getState().setLayerState("findings:all", { visible: false }));
    expect(workspace.getState().layerState["zones:all"]?.visible ?? true).toBe(true);
    act(() => tools.getState().activate("finding-point"));
    expect(workspace.getState().layerState["findings:all"]?.visible).toBe(true);
  });

  it("entering Side-by-side closes the panel; leaving it does not reopen it (R6)", () => {
    const { workspace, rail } = renderMapRail();
    expect(rail.getState().open).toBe(true);
    act(() => workspace.getState().setMode("side"));
    expect(rail.getState().open).toBe(false);
    act(() => workspace.getState().setMode("single"));
    expect(rail.getState().open).toBe(false);
    act(() => rail.getState().openTopic("layers"));
    act(() => workspace.getState().setMode("swipe"));
    expect(rail.getState().open).toBe(true);
  });

  it("defaults to Layers when the project has no base data", () => {
    const { rail } = renderMapRail({ hasBaseData: false });
    expect(rail.getState().topic).toBe("layers");
  });

  it("lists the five topics, shared first, with select and pan on the rail", () => {
    const { result } = renderMapRail();
    expect(result.current.topics.map((t) => [t.id, t.group])).toEqual([
      ["layers", "shared"],
      ["findings", "shared"],
      ["measure", "shared"],
      ["ai", "workspace"],
      ["drawings", "workspace"],
    ]);
  });
});
