import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTools, type MapTool } from "@/mapws/w4host";
import { makeStores, renderInWorkspace } from "../test/harness";
import aiRegionTool from "../tools/aiRegion.tool";
import { useDetectStore } from "./detectStore";
import { RegionDrawOverlay } from "./RegionDrawOverlay";

const TOOLS: Record<string, MapTool> = {
  "ai-region": aiRegionTool,
  select: { ...aiRegionTool, id: "select", draw: { shape: "none" }, Overlay: undefined },
};

/** Mounts the Overlay only while the AI detect tool is active, as MapWorkspace does. */
function Host() {
  const active = useTools((s) => s.active);
  return active === "ai-region" ? <RegionDrawOverlay /> : null;
}

function setup() {
  const stores = makeStores({ lookup: (id) => TOOLS[id] });
  act(() => stores.tools.getState().activate("ai-region"));
  const view = renderInWorkspace(<Host />, { stores });
  return view;
}

describe("RegionDrawOverlay", () => {
  beforeEach(() => {
    useDetectStore.setState({ regionDraft: null });
  });

  it("a completed box becomes the region draft, selects region:draft and returns to Select", async () => {
    const { stores } = setup();
    act(() => stores.tools.getState().completeBox([10, 20, 30, 40]));
    await waitFor(() => expect(stores.tools.getState().active).toBe("select"));
    expect(useDetectStore.getState().regionDraft).toEqual([
      [10, 20],
      [30, 20],
      [30, 40],
      [10, 40],
    ]);
    expect(stores.workspace.getState().selection).toEqual({ kind: "region", id: "draft" });
    expect(stores.tools.getState().completed).toBeNull();
  });

  it("ignores another tool's completion", () => {
    const { stores } = setup();
    act(() => {
      stores.tools.setState({
        completed: {
          toolId: "volume",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      });
    });
    expect(useDetectStore.getState().regionDraft).toBeNull();
    expect(stores.workspace.getState().selection).toBeNull();
    expect(stores.tools.getState().active).toBe("ai-region");
  });
});
