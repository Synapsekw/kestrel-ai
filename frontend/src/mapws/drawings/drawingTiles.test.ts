import { describe, expect, it, vi } from "vitest";
import TileLayer from "ol/layer/Tile";
import type TileImage from "ol/source/TileImage";
import { frameKey } from "@/api/drawings";
import { siteProjection, siteTileGrid } from "@/mapws/view/siteFrame";
import { createDrawingLayer } from "./drawingTiles";
import { SITE_FRAME } from "./testFixtures";

const ctx = () => ({
  tileGrid: siteTileGrid(18),
  projection: siteProjection(SITE_FRAME),
  baseUrl: "http://fake",
  token: "t",
  projectId: "p1",
});

// Preflight #2/PF4: the tile loader is W2's `makeSiteTileLoader` (tested in siteTileLoader.test.ts);
// the brief's own `rasterTileLoader`/`TRANSPARENT_PNG` and their three tests are dropped.
describe("createDrawingLayer (raster)", () => {
  it("is a tile layer on the site grid whose URL follows version, frame, preview and knockout", () => {
    const c = ctx();
    const fk = frameKey(SITE_FRAME);
    const h = createDrawingLayer({ id: "d1", vector: false }, c, { v: "2", frame: fk }, vi.fn());
    expect(h.layer).toBeInstanceOf(TileLayer);
    const source = (h.layer as TileLayer<TileImage>).getSource()!;
    expect(source.getTileGrid()).toBe(c.tileGrid);
    const url = () => source.getUrls()![0];
    // PF3: frame_key is siteCode(frame) ("EPSG:32638"), URL-encoded.
    expect(url()).toContain("/site-tiles/drawing_raster/d1/{z}/{x}/{y}?");
    expect(url()).toContain("v=2");
    expect(url()).toContain("frame_key=EPSG%3A32638");
    expect(url()).not.toContain("t=1");
    h.update({ v: "3", frame: fk, preview: [1, 0, 0, 0, 1, 0], knockout: true });
    expect(url()).toContain("v=3");
    expect(url()).toContain("t=1%2C0%2C0%2C0%2C1%2C0");
    expect(url()).toContain("knockout=true");
  });

  it("does not touch the source when the query is unchanged", () => {
    const fk = frameKey(SITE_FRAME);
    const h = createDrawingLayer({ id: "d1", vector: false }, ctx(), { v: "2", frame: fk }, vi.fn());
    const source = (h.layer as TileLayer<TileImage>).getSource()!;
    const setUrl = vi.spyOn(source, "setUrl");
    h.update({ v: "2", frame: fk, preview: null, knockout: false });
    expect(setUrl).not.toHaveBeenCalled();
  });

  it("never throws for a vector drawing in slice A: a hidden no-op layer (PF5)", () => {
    const h = createDrawingLayer(
      { id: "dxf", vector: true },
      ctx(),
      { v: "1", frame: frameKey(SITE_FRAME) },
      vi.fn(),
    );
    expect(h.layer.getVisible()).toBe(false);
    expect(() => h.update({ v: "2", frame: "x", knockout: true })).not.toThrow();
    expect(() => h.setHidden(new Set(["TEXT"]))).not.toThrow();
  });
});
