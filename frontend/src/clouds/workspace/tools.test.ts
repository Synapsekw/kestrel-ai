import { describe, expect, it } from "vitest";
import { resolveCloudKey } from "@/clouds/keys";
import { ENTRY, NAV_TOOLS, PALETTE, TOOL_OF_ACTION, navOf } from "./tools";

const key = (k: string) => ({
  key: k.toLowerCase(),
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
});

describe("the palette (spec §6)", () => {
  it("lists the mockup's twelve tools in four groups", () => {
    expect(PALETTE.map((g) => g.map((t) => t.id))).toEqual([
      ["orbit", "pan", "fly"],
      ["point", "distance", "height", "vertical", "area", "section"],
      ["clip"],
      ["pin", "photo"],
    ]);
    expect(NAV_TOOLS).toEqual(["orbit", "pan", "fly"]);
  });

  it("binds each tool to its own key, resolved through the one keymap", () => {
    const flat = PALETTE.flat();
    expect(new Set(flat.map((t) => t.shortcut)).size).toBe(flat.length);
    for (const t of flat) {
      const hit = resolveCloudKey(key(t.shortcut), "orbit");
      expect(hit?.action, t.id).toBe(t.action);
      expect(TOOL_OF_ACTION[t.action]).toBe(t.id);
    }
    expect(ENTRY.orbit.shortcut).toBe("O");
    expect(ENTRY.pan.shortcut).toBe("H");
    expect(ENTRY.pin.shortcut).toBe("M");
    expect(TOOL_OF_ACTION["tool-select"]).toBe("orbit"); // V, F's global select key
  });

  it("maps tools onto the engine's navigation modes", () => {
    expect(navOf("fly")).toBe("fly");
    expect(navOf("pan")).toBe("pan");
    expect(navOf("distance")).toBe("orbit");
    expect(navOf("clip")).toBe("orbit");
  });
});
