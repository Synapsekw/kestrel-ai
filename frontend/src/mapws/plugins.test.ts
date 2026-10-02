import { describe, expect, it } from "vitest";
import { MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { inspectorRegistry } from "./inspect/inspectorRegistry";
import { layerRegistry } from "./layers/layerRegistry";
import "./plugins";
import { UTM33, layer } from "./test/fixtures";
import { toolRegistry } from "./tools/toolStore";

describe("W1's plugins, discovered from their files (R-W1-1)", () => {
  it("registers Select, Pan, the no-coordinates rows and the finding inspector", () => {
    expect(toolRegistry.get("select")).toMatchObject({
      action: "tool-select",
      topic: "nav",
      icon: "cursor",
    });
    expect(toolRegistry.get("pan")).toMatchObject({
      action: "tool-pan",
      topic: "nav",
      icon: "hand",
    });
    expect(layerRegistry.get("map_nocrs")?.group).toBe("base");
    expect(inspectorRegistry.get("finding")).toMatchObject({
      framed: false,
      label: "Finding",
    });
  });

  it("lists a map with no coordinates greyed, linking to the evaluation view (spec §14)", () => {
    const rows = layerRegistry.get("map_nocrs")!.rows({
      projectId: PROJECT_ID,
      frame: UTM33,
      layers: [
        layer("map", MAP_ID, {
          name: "Scan",
          in_frame: false,
          footprint_site: null,
        }),
        layer("map", "in-frame"),
        layer("drawing", "not-placed", { in_frame: false }),
      ],
      surveys: [],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        key: `map_nocrs:${MAP_ID}`,
        name: "Scan",
        group: "base",
        unavailable: {
          reason: "No coordinates",
          href: `/p/${PROJECT_ID}/maps/${MAP_ID}/evaluate`,
          linkLabel: "Open in evaluation view",
        },
      }),
    ]);
  });
});
