import { beforeEach, describe, expect, it } from "vitest";
import type { LayerRowsContext } from "@/mapws/layers/layerRegistry";
import drawingLayer from "@/mapws/layers/drawing.layer";
import { layer } from "@/mapws/test/fixtures";
import { drawingRowMenu, drawingRows } from "./drawingRows";
import { useDrawingUi } from "./drawingUi";
import { useDrawingsStore } from "./drawingsStore";
import { drawingRowOf, dxfDrawing, pdfDrawing, placedPdfDrawing, SITE_FRAME } from "./testFixtures";

describe("the drawing layer kind", () => {
  beforeEach(() => useDrawingUi.getState().clear());

  it("is in the Drawings group with a Mount", () => {
    expect(drawingLayer).toMatchObject({ id: "drawing", group: "drawings", icon: "drawing" });
    expect(drawingLayer.Mount).toBeDefined();
    expect(drawingLayer.menu).toBe(drawingRowMenu);
  });

  it("makes one undated row per drawing, badged GEO when placed (spec §5.2)", () => {
    const layers = [placedPdfDrawing, pdfDrawing].map((d, i) => drawingRowOf({ ...d, id: `d${i}` }).layer!);
    // PF2: the contract WorkspaceLayer rows, no cast; other kinds are not drawing rows.
    const ctx: LayerRowsContext = {
      projectId: "p1",
      frame: SITE_FRAME,
      layers: [...layers, layer("map", "m1")],
      surveys: [],
    };
    const rows = drawingRows(ctx);
    expect(rows.map((r) => [r.key, r.date, r.badge])).toEqual([
      ["drawing:d0", null, "GEO"],
      ["drawing:d1", null, undefined],
    ]);
    expect(rows[1]).toMatchObject({
      kind: "drawing",
      group: "drawings",
      id: "d1",
      name: pdfDrawing.name,
      meta: "not placed",
      version: "0",
      layer: layers[1],
    });
  });

  it("row menu: Properties, Re-import, Delete only; Align, knockout and DXF layers live in the inspector (spec §3.1)", () => {
    useDrawingsStore.getState().set("p:0", "p", [pdfDrawing, dxfDrawing]);
    const raster = drawingRowMenu(drawingRowOf(pdfDrawing));
    expect(raster.map((i) => i.label)).toEqual(["Properties", "Re-import…", "Delete…"]);
    expect(drawingRowMenu(drawingRowOf(dxfDrawing)).map((i) => i.label)).toEqual([
      "Properties",
      "Re-import…",
      "Delete…",
    ]);
    for (const gone of ["Align", "Knock out white", "Show white", "Layers…"])
      expect(raster.some((i) => i.label === gone)).toBe(false);
    expect(raster[2].danger).toBe(true);
    raster[0].onSelect();
    expect(useDrawingUi.getState().intent).toEqual({ kind: "properties", id: pdfDrawing.id });
    raster[2].onSelect();
    expect(useDrawingUi.getState().intent).toEqual({ kind: "delete", id: pdfDrawing.id });
  });
});
