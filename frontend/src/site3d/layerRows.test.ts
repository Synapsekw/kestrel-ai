import { describe, expect, it } from "vitest";
import { FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import type { SiteLayer } from "@/site3d/layers/types";
import { extraRows, groupRows, s1Rows, sceneLayerRows, statusLine } from "./layerRows";

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
    // Ruling R-S1-15: the view could not start, so the model is not shown (not "Loading" forever).
    const off = sceneLayerRows(MODEL_SCENE, "off", 0)[0];
    expect([off.detail, off.available, off.toggleable]).toEqual(["Not shown", true, false]);
  });
});

const layer = (id: string, label: string, opacity = false) =>
  ({
    id,
    label,
    attach() {},
    detach() {},
    setVisible() {},
    ...(opacity ? { setOpacity() {} } : {}),
  }) as SiteLayer;

describe("panel rows", () => {
  it("puts the model first and orthos and drawings under Imagery, with opacity where the layer has it", () => {
    const rows = s1Rows(
      [
        layer("model", "Plant model", true),
        layer("ortho:o1", "May ortho", true),
        layer("drawing:d1", "T0006"),
      ],
      { visible: { "ortho:o1": false }, opacity: { model: 0.6 } },
    );
    expect(rows.map((r) => [r.id, r.group, r.visible, r.opacity])).toEqual([
      ["model", "Model", true, 0.6],
      ["ortho:o1", "Imagery", false, 1],
      ["drawing:d1", "Imagery", true, null],
    ]);
  });

  it("keeps the model's status copy and marks a removed map unavailable", () => {
    const ls = [layer("model", "Plant model"), layer("ortho:o1", "May ortho"), layer("drawing:d1", "T0006")];
    const ui = { visible: {}, opacity: {}, gone: new Set(["ortho:o1", "drawing:d1"]) };
    const lines = (model: { state: "loading" | "error" | "ready" | "off"; items: number }) =>
      s1Rows(ls, { ...ui, model }).map((r) => statusLine(r.status)?.text);
    expect(lines({ state: "ready", items: 2 })).toEqual([
      "2 items",
      "This map was removed.",
      "This drawing was removed.",
    ]);
    expect(lines({ state: "loading", items: 0 })[0]).toBe("Loading");
    expect(lines({ state: "error", items: 0 })[0]).toBe("Could not load");
    expect(lines({ state: "off", items: 0 })[0]).toBe("Not shown");
    expect(s1Rows(ls, { ...ui, model: { state: "ready", items: 1 } })[0].status).toEqual({
      kind: "ready",
      note: "1 item",
    });
  });

  it("reads S2's rows with their live status and no opacity", () => {
    const [row] = extraRows([
      {
        id: "water",
        label: "Water",
        group: "Environment",
        visible: true,
        layer: { status: { get: () => ({ kind: "ready" as const }) } },
      },
    ]);
    expect([row.id, row.group, row.visible, row.opacity, row.status]).toEqual([
      "water",
      "Environment",
      true,
      null,
      { kind: "ready" },
    ]);
  });

  it("groups in the panel's order and drops empty groups", () => {
    const rows = [...extraRows([]), ...s1Rows([layer("model", "Plant model")], { visible: {}, opacity: {} })];
    expect(groupRows(rows).map(([g]) => g)).toEqual(["Model"]);
  });

  it("turns a status into one line of copy", () => {
    expect(statusLine({ kind: "ready" })).toBeNull();
    expect(statusLine({ kind: "ready", note: "Flat water (reduced effects)" })).toEqual({
      text: "Flat water (reduced effects)",
      tone: "muted",
    });
    expect(statusLine({ kind: "unavailable", reason: "This model has no sea." })).toEqual({
      text: "This model has no sea.",
      tone: "muted",
    });
    expect(statusLine({ kind: "error", message: "The cloud could not load: HTTP 404" })).toEqual({
      text: "The cloud could not load: HTTP 404",
      tone: "danger",
    });
    expect(statusLine({ kind: "loading" })).toEqual({ text: "Loading…", tone: "muted" });
  });
});
