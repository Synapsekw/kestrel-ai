import { describe, expect, it } from "vitest";
import "./plugins";
import { layerRegistry } from "./layers/layerRegistry";
import { panelRegistry } from "./panels/panelRegistry";

describe("W2 plugins are discovered by W1 (R-W1-1)", () => {
  it("registers the map and surface layer kinds", () => {
    expect(layerRegistry.get("map")?.group).toBe("base");
    expect(layerRegistry.get("surface")).toMatchObject({
      group: "elevation",
      defaultVisible: false,
    });
  });

  it("registers the six panels and the dialog host in their slots", () => {
    const slotOf = (id: string) => panelRegistry.get(id)?.slot;
    expect(slotOf("compare")).toBe("top-center");
    expect(slotOf("timeline")).toBe("bottom-center");
    expect(slotOf("minimap")).toBe("bottom-right");
    expect(slotOf("readout-z")).toBe("coords-extra");
    expect(slotOf("compare-stage")).toBe("stage");
    expect(slotOf("raster-dialogs")).toBe("stage");
  });

  it("registers the frame-switch panel (Task 11a)", () => {
    expect(panelRegistry.get("frame-switch")).toMatchObject({
      slot: "coords-extra",
      order: 10,
    });
  });
});
