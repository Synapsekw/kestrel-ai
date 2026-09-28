import { afterEach, describe, expect, it, vi } from "vitest";
import TileLayer from "ol/layer/Tile";
import VectorTileLayer from "ol/layer/VectorTile";
import TileState from "ol/TileState";
import type TileImage from "ol/source/TileImage";
import type VectorTileSource from "ol/source/VectorTile";
import type LineString from "ol/geom/LineString";
import type Feature from "ol/Feature";
import { frameKey, type DrawingVectorTile } from "@/api/drawings";
import { siteProjection, siteTileGrid } from "@/mapws/view/siteFrame";
import { SELECTION_PROP } from "../layers/layerRegistry";
import {
  createDrawingLayer,
  drawingStyle,
  hiddenLayers,
  vectorTileLoader,
  vtileFeatures,
} from "./drawingTiles";
import { dxfDrawing, SITE_FRAME } from "./testFixtures";

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
});

const JSON_TILE: DrawingVectorTile = {
  layers: [
    {
      name: "WALLS",
      colour: "#ff0000",
      lines: [
        [0, 0, 10, 0, 10, 10],
        [5, 5],
      ],
    },
    { name: "TEXT", colour: "#ffffff", lines: [[1, 1, 2, 2]] },
  ],
  labels: [
    { text: "PIT", x: 5, y: 5, height_m: 2, rotation: 90 },
    { text: "WALL A", x: 1, y: 1, height_m: 2, rotation: 0, layer: "TEXT" },
  ],
  truncated: false,
};

describe("vector tiles (spec §8.4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses runs into line features per layer and labels into points; drops a run under 2 vertices", () => {
    const f = vtileFeatures(JSON_TILE);
    expect(f.map((x) => (x.get("layer") as string | undefined) ?? `label:${x.get("text")}`)).toEqual([
      "WALLS",
      "TEXT",
      "label:PIT",
      "label:WALL A",
    ]);
    expect((f[0].getGeometry() as LineString).getCoordinates()).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("tags every line and label with the drawing's selection, so a click on linework selects it (PF11)", () => {
    const f = vtileFeatures(JSON_TILE, "d9");
    expect(f.map((x) => x.get(SELECTION_PROP) as unknown)).toEqual(
      Array(4).fill({ kind: "drawing", id: "d9" }),
    );
  });

  it("hides layers by style only, and draws labels from 6 px, rotated clockwise (R-W5-13)", () => {
    const style = drawingStyle({ hidden: new Set(["TEXT"]), colour: "rgba(95, 227, 192, 1)" });
    const [walls, text, label, textLabel] = vtileFeatures(JSON_TILE);
    expect(style(walls, 1)).toBeDefined();
    expect(style(text, 1)).toBeUndefined();
    expect(style(textLabel, 0.1)).toBeUndefined(); // a label of a hidden layer hides with it
    expect(style(label, 0.25)!.getText()!.getRotation()).toBeCloseTo(-Math.PI / 2);
    expect(style(label, 0.25)!.getText()!.getFont()).toMatch(/^8px /); // 2 m / 0.25 m/px
    expect(style(label, 0.01)!.getText()!.getFont()).toMatch(/^48px /); // capped
    expect(style(label, 0.4)).toBeUndefined(); // 5 px < 6 px
    expect(style(walls, 1)!.getStroke()!.getColor()).toBe("rgba(95, 227, 192, 1)");
    expect(style(label, 0.25)!.getText()!.getFill()!.getColor()).toBe("rgba(95, 227, 192, 1)");
  });

  it("reads hidden layers from layer_state", () => {
    expect([...hiddenLayers(dxfDrawing)]).toEqual(["TEXT"]);
  });

  const stubStatus = (byUrl: Record<string, number>, body?: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        const status = byUrl[u.slice(u.lastIndexOf("/") + 1)];
        return new Response(status === 200 ? JSON.stringify(body) : null, { status });
      }),
    );
  const mk = () => ({ setFeatures: vi.fn(), setState: vi.fn() });

  it("a 404 or 410 errors the tile and reports gone; a 204 is an empty tile; a 200 sets the features", async () => {
    stubStatus({ a: 404, g: 410, b: 204, c: 200 }, JSON_TILE);
    const onGone = vi.fn();
    const [a, g, b, c] = [mk(), mk(), mk(), mk()];
    vectorTileLoader(onGone, "d9")(a as never, "http://fake/a");
    vectorTileLoader(onGone, "d9")(g as never, "http://fake/g");
    vectorTileLoader(onGone, "d9")(b as never, "http://fake/b");
    vectorTileLoader(onGone, "d9")(c as never, "http://fake/c");
    await vi.waitFor(() => expect(b.setFeatures).toHaveBeenCalledWith([]));
    await vi.waitFor(() => expect(a.setState).toHaveBeenCalledWith(TileState.ERROR));
    await vi.waitFor(() => expect(g.setState).toHaveBeenCalledWith(TileState.ERROR));
    await vi.waitFor(() => expect(c.setFeatures).toHaveBeenCalled());
    const features = c.setFeatures.mock.calls[0][0] as Feature[];
    expect(features).toHaveLength(4);
    expect(features[0].get(SELECTION_PROP)).toEqual({ kind: "drawing", id: "d9" });
    expect(onGone).toHaveBeenCalledTimes(2);
  });

  it("409 not_placed and 422 (not_vector, no_coordinates, invalid_preview) are plain errors, not gone", async () => {
    stubStatus({ n: 409, v: 422 });
    const onGone = vi.fn();
    const [n, v] = [mk(), mk()];
    vectorTileLoader(onGone)(n as never, "http://fake/n");
    vectorTileLoader(onGone)(v as never, "http://fake/v");
    await vi.waitFor(() => expect(n.setState).toHaveBeenCalledWith(TileState.ERROR));
    await vi.waitFor(() => expect(v.setState).toHaveBeenCalledWith(TileState.ERROR));
    expect(onGone).not.toHaveBeenCalled();
  });

  it("creates a vector-tile layer whose layer toggles never refetch", () => {
    const fk = frameKey(SITE_FRAME);
    const h = createDrawingLayer({ id: dxfDrawing.id, vector: true }, ctx(), { v: "1", frame: fk }, vi.fn());
    expect(h.layer).toBeInstanceOf(VectorTileLayer);
    const layer = h.layer as VectorTileLayer<VectorTileSource>;
    const source = layer.getSource()!;
    const url = () => source.getUrls()![0];
    expect(url()).toContain(`/drawings/${dxfDrawing.id}/vtiles/{z}/{x}/{y}?`);
    expect(url()).toContain("v=1");
    expect(url()).toContain("frame_key=EPSG%3A32638");
    const before = url();
    const setUrl = vi.spyOn(source, "setUrl");
    const styleBefore = layer.getStyleFunction();
    h.setHidden(new Set(["WALLS"]));
    expect(url()).toBe(before);
    expect(setUrl).not.toHaveBeenCalled();
    expect(layer.getStyleFunction()).not.toBe(styleBefore);
    h.update({ v: "1", frame: fk, preview: [1, 0, 0, 0, 1, 0] });
    expect(url()).toContain("t=1%2C0%2C0%2C0%2C1%2C0");
  });
});
