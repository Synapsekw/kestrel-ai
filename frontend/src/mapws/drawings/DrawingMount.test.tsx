import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type TileLayer from "ol/layer/Tile";
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
const added = (map: FakeMap): Layer[] => map.addLayer.mock.calls.map((c) => c[0] as Layer);

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

  it("never throws for a vector drawing: a hidden layer until vector tiles arrive (PF5)", () => {
    const { map } = mount(dxfDrawing);
    expect(added(map)).toHaveLength(1);
    expect(added(map)[0].getVisible()).toBe(false);
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

  it("previews an align session at half opacity with the session transform (debounced 250 ms)", () => {
    vi.useFakeTimers();
    const { map } = mount(pdfDrawing);
    const layer = added(map)[0];
    act(() => useAlignStore.getState().begin(session(pdfDrawing.id)));
    expect(layer.getVisible()).toBe(true);
    expect(layer.getOpacity()).toBeCloseTo(0.4);
    expect(layer.getSource()!.getUrls()![0]).not.toMatch(/[?&]t=/);
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS));
    expect(PREVIEW_DEBOUNCE_MS).toBe(250);
    expect(layer.getSource()!.getUrls()![0]).toContain("t=0.03%2C0%2C1%2C0%2C0.03%2C2");
    act(() => useAlignStore.getState().end());
    expect(layer.getVisible()).toBe(false);
    expect(layer.getOpacity()).toBe(0.8);
    expect(layer.getSource()!.getUrls()![0]).not.toMatch(/[?&]t=/);
    expect(added(map)).toHaveLength(1);
  });

  it("ignores another drawing's align session", () => {
    const { map } = mount(pdfDrawing);
    act(() => useAlignStore.getState().begin(session("someone-else")));
    expect(added(map)[0].getVisible()).toBe(false);
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
