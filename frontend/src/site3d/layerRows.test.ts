import { describe, expect, it } from "vitest";
import { FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import { sceneLayerRows } from "./layerRows";

describe("sceneLayerRows", () => {
  it("greys what the project does not have (Review Focus 1)", () => {
    const rows = sceneLayerRows(FRAME_ONLY_SCENE, "none", 0);
    expect(rows.map((r) => [r.id, r.available, r.detail])).toEqual([
      ["model", false, "None yet"],
      ["ortho", false, "None placed"],
      ["drawing", false, "None placed"],
      ["cloud", false, "None"],
      ["photos", false, "None"],
      ["findings", false, "None"],
    ]);
  });

  it("counts what is there; S2 layers are not toggleable yet (R14)", () => {
    const rows = Object.fromEntries(sceneLayerRows(TILE_SCENE, "ready", 2).map((r) => [r.id, r]));
    expect(rows.model.detail).toBe("2 items");
    expect(rows.model.toggleable).toBe(true);
    expect(rows.ortho.detail).toBe("1 map");
    expect(rows.drawing.detail).toBe("1 drawing");
    expect(rows.cloud.detail).toBe("1 cloud · not in this view yet");
    expect(rows.cloud.toggleable).toBe(false);
    expect(rows.photos.detail).toBe("36 photos · not in this view yet");
  });

  it("says when the model is loading or failed", () => {
    expect(sceneLayerRows(MODEL_SCENE, "loading", 0)[0].detail).toBe("Loading");
    expect(sceneLayerRows(MODEL_SCENE, "error", 0)[0].detail).toBe("Could not load");
    expect(sceneLayerRows(MODEL_SCENE, "ready", 1)[0].detail).toBe("1 item");
  });
});
