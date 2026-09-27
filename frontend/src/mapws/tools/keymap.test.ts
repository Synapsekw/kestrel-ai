import { describe, expect, it } from "vitest";
import { GLOBAL_KEYS, KEYMAP, WORKSPACE_KEYS, findCollisions } from "@/ui";
import { MAP_TOOL_ACTIONS, WORKSPACE_ACTIONS, shortcutFor } from "./toolStore";

describe("the map tools against F's keymap (spec §5.1, §15; deviation 1)", () => {
  it("has a tool id or a workspace handler for every maps key", () => {
    const known = new Set<string>([...Object.values(MAP_TOOL_ACTIONS), ...WORKSPACE_ACTIONS]);
    for (const e of WORKSPACE_KEYS.maps) expect(known.has(e.action), e.action).toBe(true);
  });

  it("reads each tool's key from the keymap", () => {
    expect(
      Object.fromEntries(Object.entries(MAP_TOOL_ACTIONS).map(([id, action]) => [id, shortcutFor(action)])),
    ).toEqual({
      select: "V",
      pan: "H",
      distance: "L",
      area: "Q",
      profile: "E",
      volume: "U",
      "finding-point": "M",
      "finding-polygon": "G",
      zone: "Z",
      "align-drawing": "K",
      "ai-region": "D",
    });
  });

  it("never hands a tool a review key or a non-tool global key", () => {
    expect(shortcutFor("accept")).toBeUndefined();
    expect(shortcutFor("fit")).toBeUndefined();
    expect(shortcutFor("no-such-action")).toBeUndefined();
  });

  it("plays on P and pans on a held Space, and F's table has no collision", () => {
    expect(WORKSPACE_KEYS.maps.find((e) => e.action === "play")?.keys).toEqual(["P"]);
    expect(GLOBAL_KEYS.find((e) => e.action === "pan-hold")?.keys).toEqual(["Space"]);
    expect(findCollisions(KEYMAP)).toEqual([]);
  });
});
