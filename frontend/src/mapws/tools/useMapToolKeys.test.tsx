import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeStores, renderHookInWorkspace } from "../test/harness";
import { LOCAL, UTM33 } from "../test/fixtures";
import { useTopicTools } from "../topics/TopicTools";
import type { SiteFrame } from "../types";
import { registerTool, toolRegistry, type MapTool } from "./toolStore";
import { useMapToolKeys } from "./useMapToolKeys";

const offs: (() => void)[] = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

const T = (t: Partial<MapTool> & Pick<MapTool, "id" | "action">): MapTool => ({
  topic: "measure",
  order: 0,
  icon: "measure",
  label: t.id,
  hint: "",
  draw: { shape: "none" },
  ...t,
});

function setup(frame: SiteFrame = UTM33) {
  offs.push(
    registerTool(T({ id: "select", action: "tool-select", topic: "nav" })),
    registerTool(T({ id: "pan", action: "tool-pan", topic: "nav", order: 1 })),
    registerTool(T({ id: "distance", action: "measure-length", draw: { shape: "line", min: 2 } })),
    registerTool(
      T({
        id: "finding-point",
        action: "finding-marker",
        topic: "findings",
        disabledReason: (ctx) => (ctx.frame.kind === "local" ? "Findings need a map with coordinates" : null),
      }),
    ),
    registerTool(T({ id: "typo", action: "measure-lenght" })),
  );
  const stores = makeStores({ frame, lookup: (id) => toolRegistry.get(id) });
  const context = { frame, selection: null, surveys: [], layers: [], r: null };
  const { result } = renderHookInWorkspace(
    () => {
      useMapToolKeys(context);
      return useTopicTools("measure", context);
    },
    { stores },
  );
  return { tools: stores.tools, result };
}

describe("useMapToolKeys (spec §4 Tool keys)", () => {
  it("arms a tool by its key whatever topic is open; V and H reach Select and Pan", () => {
    const { tools } = setup();
    act(() => void fireEvent.keyDown(window, { key: "l" }));
    expect(tools.getState().active).toBe("distance");
    act(() => void fireEvent.keyDown(window, { key: "h" }));
    expect(tools.getState().active).toBe("pan");
    act(() => void fireEvent.keyDown(window, { key: "v" }));
    expect(tools.getState().active).toBe("select");
  });

  it("a disabled tool's key does nothing", () => {
    const { tools } = setup(LOCAL);
    act(() => void fireEvent.keyDown(window, { key: "m" }));
    expect(tools.getState().active).toBe("select");
  });

  it("ignores tool keys typed into a field", () => {
    const { tools } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    act(() => void fireEvent.keyDown(input, { key: "l" }));
    input.remove();
    expect(tools.getState().active).toBe("select");
  });

  it("gives a tool with an unknown action no key (Review Focus 3)", () => {
    const { tools, result } = setup();
    expect(result.current.find((t) => t.id === "typo")?.shortcut).toBeUndefined();
    for (const key of "abcdefghijklmnopqrstuvwxyz") {
      act(() => void fireEvent.keyDown(window, { key }));
      expect(tools.getState().active).not.toBe("typo");
    }
  });
});
