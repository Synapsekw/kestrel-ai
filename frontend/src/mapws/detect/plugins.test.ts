import { describe, expect, it } from "vitest";
import { WORKSPACE_KEYS } from "@/ui";
import detectionInspector from "../inspect/detection.inspector";
import regionInspector from "../inspect/region.inspector";
import runInspector from "../inspect/run.inspector";
import detectionsLayer from "../layers/detections.layer";
import aiRegionTool from "../tools/aiRegion.tool";

describe("detect plugins", () => {
  it("D is AI detect in a region, drawn as a box", () => {
    expect(WORKSPACE_KEYS.maps.find((e) => e.action === aiRegionTool.action)?.keys).toEqual(["D"]);
    expect(aiRegionTool).toMatchObject({
      id: "ai-region",
      action: "ai-detect",
      topic: "ai",
      order: 1,
      draw: { shape: "box" },
    });
    expect(aiRegionTool.Overlay).toBeDefined();
    const ctx = { selection: null, surveys: [], layers: [], r: null };
    expect(aiRegionTool.disabledReason?.({ ...ctx, frame: { kind: "local" } as never })).toBe(
      "AI detect needs a site with coordinates",
    );
    expect(aiRegionTool.disabledReason?.({ ...ctx, frame: { kind: "crs" } as never })).toBeNull();
  });

  it("registers the AI detections row with its filters, and three inspector kinds with their own panes", () => {
    expect(detectionsLayer).toMatchObject({
      id: "detections",
      group: "annotations",
    });
    expect(detectionsLayer.Mount).toBeDefined();
    expect(detectionsLayer.RowExtra).toBeDefined();
    // Default-visible (ruling T15-3): M-X flow 5 clicks a box right after the sel=run: arrival.
    expect(detectionsLayer.defaultVisible ?? true).toBe(true);
    expect(
      detectionsLayer.rows({
        projectId: "p",
        frame: {} as never,
        layers: [],
        surveys: [],
      }),
    ).toEqual([
      expect.objectContaining({
        key: "detections:detections",
        kind: "detections",
        id: "detections",
        name: "AI detections",
        date: null,
      }),
    ]);
    expect([detectionInspector.id, runInspector.id, regionInspector.id]).toEqual([
      "detection",
      "run",
      "region",
    ]);
    expect([detectionInspector.framed, runInspector.framed, regionInspector.framed]).toEqual([
      false,
      false,
      false,
    ]);
    expect(detectionInspector.hint).toBeDefined();
  });
});
