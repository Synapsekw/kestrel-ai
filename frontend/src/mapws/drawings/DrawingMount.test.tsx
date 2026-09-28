import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorTileLayer from "ol/layer/VectorTile";
import type VectorTileSource from "ol/source/VectorTile";
import type VectorSource from "ol/source/Vector";
import type TileImage from "ol/source/TileImage";
import type { Drawing } from "@/api/drawings";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useToastStore } from "@/ui";
import { useAlignStore } from "../georef/alignStore";
import type { AlignSession } from "../georef/alignModel";
import { useGoneLayers } from "../layers/goneLayers";
import type { RowSide } from "../types";
import { fakeOlMap } from "../test/rasterFixtures";
import { DrawingMount, PREVIEW_DEBOUNCE_MS } from "./DrawingMount";
import { useDrawingsStore } from "./drawingsStore";
import { dxfDrawing, drawingRowOf, pdfDrawing, placedPdfDrawing, SITE_FRAME } from "./testFixtures";

type Layer = TileLayer<TileImage>;
type FakeMap = ReturnType<typeof fakeOlMap>;
const added = (map: FakeMap): Layer[] =>
  map.addLayer.mock.calls.map((c) => c[0] as unknown).filter((l): l is Layer => l instanceof TileLayer);
type VLayer = VectorTileLayer<VectorTileSource>;
const addedVector = (map: FakeMap): VLayer[] =>
  map.addLayer.mock.calls
    .map((c) => c[0] as unknown)
    .filter((l): l is VLayer => l instanceof VectorTileLayer);
/** The align session's marks layers (bubbles, residual lines), in the order they were added. */
const marksOf = (map: FakeMap): VectorLayer<VectorSource>[] =>
  map.addLayer.mock.calls
    .map((c) => c[0] as unknown)
    .filter((l): l is VectorLayer<VectorSource> => l instanceof VectorLayer);
const kinds = (l: VectorLayer<VectorSource>) =>
  l
    .getSource()!
    .getFeatures()
    .map((f) => (f.get("mark") as { kind: string }).kind)
    .sort();

function mountOn(maps: { map: FakeMap; side: RowSide }[], d: Drawing = placedPdfDrawing) {
  // The list the mount reads: `placedPdfDrawing` and `pdfDrawing` share an id, so seed only `d`.
  useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [d]);
  const { api } = fakeClient([{ method: "GET", path: /\/drawings$/, body: { items: [d] } }]);
  return render(
    <TestApiProvider api={api}>
      {maps.map(({ map, side }) => (
        <DrawingMount
          key={side}
          row={drawingRowOf(d)}
          map={map as never}
          side={side}
          zIndex={2003}
          opacity={0.8}
          style={{}}
          projectId={PROJECT_ID}
          frame={SITE_FRAME}
        />
      ))}
    </TestApiProvider>,
  );
}

function mount(d: Drawing = placedPdfDrawing) {
  const map = fakeOlMap();
  const view = mountOn([{ map, side: "both" }], d);
  return { map, ...view };
}

const session = (drawingId: string): AlignSession => ({
  drawingId,
  model: "similarity",
  pairs: [],
  pendingSrc: null,
  extentSrc: [0, -3508, 4967, 0],
  start: [0.03, 0, 1, 0, 0.03, 2],
  transform: [0.03, 0, 1, 0, 0.03, 2],
  fit: null,
  nextId: 1,
  unitsScale: null,
});

const fakeTile = () => ({ getImage: () => ({ src: "", addEventListener: vi.fn() }), setState: vi.fn() });

describe("DrawingMount", () => {
  beforeEach(() => {
    useChangesStore.setState({ mapWorkspaceRevision: 0 });
    useAlignStore.getState().end();
    useToastStore.getState().clear();
    useGoneLayers.setState({ gone: new Set() });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("adds one raster layer with the row's opacity and order, and removes and disposes it on unmount", () => {
    const { map, unmount } = mount();
    const layers = added(map);
    expect(layers).toHaveLength(1);
    expect(layers[0].getOpacity()).toBe(0.8);
    expect(layers[0].getZIndex()).toBe(2003);
    expect(layers[0].getVisible()).toBe(true);
    const dispose = vi.spyOn(layers[0], "dispose");
    unmount();
    expect(map.removeLayer).toHaveBeenCalledWith(layers[0]);
    expect(dispose).toHaveBeenCalled();
  });

  it("draws nothing for a drawing that is not placed and not being aligned", () => {
    const { map } = mount(pdfDrawing);
    expect(added(map)[0].getVisible()).toBe(false);
  });

  it("draws nothing for a placed drawing that is not ready (a failed raster's tiles are 404)", () => {
    const failed: Drawing = { ...placedPdfDrawing, status: "failed" };
    const { map } = mount(failed);
    expect(added(map)[0].getVisible()).toBe(false);
  });

  it("draws a placed DXF as vector tiles, with its hidden layers applied as a style", () => {
    const { map } = mount(dxfDrawing);
    expect(added(map)).toHaveLength(0);
    const layers = addedVector(map);
    expect(layers).toHaveLength(1);
    expect(layers[0].getVisible()).toBe(true);
    expect(layers[0].getOpacity()).toBe(0.8);
    expect(layers[0].getSource()!.getUrls()![0]).toContain(`/drawings/${dxfDrawing.id}/vtiles/{z}/{x}/{y}?`);
    const style = layers[0].getStyleFunction()!;
    const line = (layer: string) => new Feature({ geometry: new LineString([0, 0, 1, 1], "XY"), layer });
    expect(style(line("WALLS"), 1)).toBeDefined();
    expect(style(line("TEXT"), 1)).toBeUndefined();
  });

  it("restyles a DXF when its hidden layers change, without re-URLing its tiles", () => {
    const { map } = mount(dxfDrawing);
    const layer = addedVector(map)[0];
    const url = layer.getSource()!.getUrls()![0];
    const line = new Feature({ geometry: new LineString([0, 0, 1, 1], "XY"), layer: "WALLS" });
    const next: Drawing = { ...dxfDrawing, layer_state: { hidden_layers: ["WALLS"], knockout_white: false } };
    act(() => useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [next]));
    expect(addedVector(map)).toHaveLength(1);
    expect(layer.getSource()!.getUrls()![0]).toBe(url);
    expect(layer.getStyleFunction()!(line, 1)).toBeUndefined();
  });

  it("draws nothing for a DXF that is not placed and not being aligned", () => {
    const { map } = mount({ ...dxfDrawing, georef: null });
    expect(addedVector(map)[0].getVisible()).toBe(false);
  });

  it("toasts once in Side-by-side when a DXF's vector tiles are gone (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const left = fakeOlMap();
    const right = fakeOlMap();
    mountOn(
      [
        { map: left, side: "left" },
        { map: right, side: "right" },
      ],
      dxfDrawing,
    );
    const vtile = () => ({ setFeatures: vi.fn(), setState: vi.fn() });
    addedVector(left)[0].getSource()!.getTileLoadFunction()(vtile() as never, "u1");
    addedVector(right)[0].getSource()!.getTileLoadFunction()(vtile() as never, "u2");
    await vi.waitFor(() => expect(right.removeLayer).toHaveBeenCalled());
    expect(left.removeLayer).toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].text).toMatch(/site-plan is no longer available/);
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(1);
  });

  it("puts the frame key and knockout on the tile URL", () => {
    const knocked: Drawing = {
      ...placedPdfDrawing,
      layer_state: { hidden_layers: [], knockout_white: true },
    };
    const { map } = mount(knocked);
    const url = added(map)[0].getSource()!.getUrls()![0];
    expect(url).toContain(`/drawing_raster/${placedPdfDrawing.id}/{z}/{x}/{y}?`);
    expect(url).toContain("v=2");
    expect(url).toContain("frame_key=EPSG%3A32638");
    expect(url).toContain("knockout=true");
    expect(url).not.toMatch(/[?&]t=/);
  });

  it("tiles at the drawing's georef_version, not a lagging row version (no snap-back after Save)", () => {
    useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [placedPdfDrawing]);
    const { api } = fakeClient([{ method: "GET", path: /\/drawings$/, body: { items: [placedPdfDrawing] } }]);
    const map = fakeOlMap();
    render(
      <TestApiProvider api={api}>
        <DrawingMount
          row={drawingRowOf(placedPdfDrawing, "1")}
          map={map as never}
          side="both"
          zIndex={2003}
          opacity={0.8}
          style={{}}
          projectId={PROJECT_ID}
          frame={SITE_FRAME}
        />
      </TestApiProvider>,
    );
    expect(added(map)[0].getSource()!.getUrls()![0]).toContain("v=2");
  });

  it("previews an align session at half opacity with the session transform (debounced 250 ms)", () => {
    vi.useFakeTimers();
    const { map } = mount(pdfDrawing);
    const layer = added(map)[0];
    act(() => useAlignStore.getState().begin(session(pdfDrawing.id)));
    // Not placed: nothing to show until the first `t` preview exists (the bare tiles would be 422s).
    expect(layer.getVisible()).toBe(false);
    expect(layer.getOpacity()).toBeCloseTo(0.4);
    expect(layer.getSource()!.getUrls()![0]).not.toMatch(/[?&]t=/);
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS));
    expect(PREVIEW_DEBOUNCE_MS).toBe(250);
    expect(layer.getVisible()).toBe(true);
    expect(layer.getSource()!.getUrls()![0]).toContain("t=0.03%2C0%2C1%2C0%2C0.03%2C2");
    act(() => useAlignStore.getState().end());
    expect(layer.getVisible()).toBe(false);
    expect(layer.getOpacity()).toBe(0.8);
    expect(layer.getSource()!.getUrls()![0]).not.toMatch(/[?&]t=/);
    expect(added(map)).toHaveLength(1);
  });

  it("a quick restart never shows the previous session's transform", () => {
    vi.useFakeTimers();
    const { map } = mount(pdfDrawing);
    const layer = added(map)[0];
    act(() => useAlignStore.getState().begin(session(pdfDrawing.id)));
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS));
    act(() => {
      useAlignStore.getState().end();
      useAlignStore.getState().begin({ ...session(pdfDrawing.id), transform: [0.05, 0, 7, 0, 0.05, 8] });
    });
    expect(layer.getVisible()).toBe(false);
    expect(layer.getSource()!.getUrls()![0]).not.toMatch(/[?&]t=/);
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS));
    expect(layer.getVisible()).toBe(true);
    expect(layer.getSource()!.getUrls()![0]).toContain("t=0.05%2C0%2C7%2C0%2C0.05%2C8");
  });

  it("a placed drawing stays shown while it is realigned", () => {
    const { map } = mount();
    act(() => useAlignStore.getState().begin(session(placedPdfDrawing.id)));
    expect(added(map)[0].getVisible()).toBe(true);
  });

  it("draws the session's numbered bubbles and residual lines on every map side, above the drawings", () => {
    const left = fakeOlMap();
    const right = fakeOlMap();
    mountOn(
      [
        { map: left, side: "left" },
        { map: right, side: "right" },
      ],
      pdfDrawing,
    );
    expect(marksOf(left)).toHaveLength(0);
    const s: AlignSession = {
      ...session(pdfDrawing.id),
      pairs: [{ id: "cp1", src: [100, -100], dst: [5, 1] }],
      pendingSrc: [200, -200],
      nextId: 2,
    };
    act(() => useAlignStore.getState().begin(s));
    for (const map of [left, right]) {
      expect(marksOf(map)).toHaveLength(1);
      expect(marksOf(map)[0].getZIndex()).toBeGreaterThan(2003);
      expect(kinds(marksOf(map)[0])).toEqual(["dst", "pending", "residual", "src"]);
    }
    const bubble = marksOf(left)[0]
      .getSource()!
      .getFeatures()
      .find((f) => f.get("mark").kind === "dst")!;
    const style = marksOf(left)[0].getStyleFunction()!(bubble, 1) as import("ol/style").Style;
    expect(style.getText()!.getText()).toBe("1");
    act(() => useAlignStore.getState().undo());
    expect(kinds(marksOf(left)[0])).toEqual(["dst", "residual", "src"]);
    act(() => useAlignStore.getState().end());
    expect(left.removeLayer).toHaveBeenCalledWith(marksOf(left)[0]);
    expect(right.removeLayer).toHaveBeenCalledWith(marksOf(right)[0]);
  });

  it("ignores another drawing's align session", () => {
    const { map } = mount(pdfDrawing);
    act(() => useAlignStore.getState().begin(session("someone-else")));
    expect(added(map)[0].getVisible()).toBe(false);
    expect(marksOf(map)).toHaveLength(0);
  });

  it("toasts once when the drawing's tiles are gone (404), and takes the layer off the map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const { map } = mount();
    const loader = added(map)[0].getSource()!.getTileLoadFunction();
    loader(fakeTile() as never, "u1");
    loader(fakeTile() as never, "u2");
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].text).toMatch(/foundation-plan · p2 is no longer available/);
    await vi.waitFor(() => expect(map.removeLayer).toHaveBeenCalledWith(added(map)[0]));
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(1);
  });

  it("toasts once in Side-by-side, where the row mounts on both maps (PF4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const left = fakeOlMap();
    const right = fakeOlMap();
    mountOn([
      { map: left, side: "left" },
      { map: right, side: "right" },
    ]);
    added(left)[0].getSource()!.getTileLoadFunction()(fakeTile() as never, "u1");
    added(right)[0].getSource()!.getTileLoadFunction()(fakeTile() as never, "u2");
    await vi.waitFor(() => expect(right.removeLayer).toHaveBeenCalled());
    expect(left.removeLayer).toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
