import { describe, expect, it } from "vitest";
import "@/mapws/plugins";
import { inspectorRegistry, layerRegistry, shortcutFor, slotRegistry, toolRegistry } from "./bindings";

const KEYS: Record<string, string> = {
  distance: "L",
  area: "Q",
  profile: "E",
  "finding-point": "M",
  "finding-polygon": "G",
  zone: "Z",
};

describe("W3's plugins are discovered by W1", () => {
  it("registers the six tools, each on its Maps key", () => {
    for (const [id, key] of Object.entries(KEYS)) {
      const tool = toolRegistry.get(id);
      if (!tool) throw new Error(`tool ${id} is not registered`);
      expect(shortcutFor(tool.action), id).toBe(key);
      expect(tool.Overlay, id).toBeTypeOf("function");
    }
  });

  it("registers the three annotation layers", () => {
    for (const id of ["findings", "zones", "measurements"]) {
      expect(layerRegistry.get(id)?.group, id).toBe("annotations");
    }
  });

  it("registers the measurement and zone inspectors framed, and the finding measure slot", () => {
    expect(inspectorRegistry.get("measurement")?.framed).toBe(true);
    expect(inspectorRegistry.get("measurement")?.remove?.confirm({ kind: "measurement", id: "m" })).toBe(
      "This cannot be undone.",
    );
    expect(inspectorRegistry.get("zone")?.remove?.confirm({ kind: "zone", id: "z" })).toBe(
      "Object counts update in the background.",
    );
    expect(slotRegistry.get("finding.measure")).toBeDefined();
  });
});
