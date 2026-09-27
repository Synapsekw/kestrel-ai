import { Profiler, type ComponentProps } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStores } from "../test/harness";
import { UTM33 } from "../test/fixtures";
import { AUG, SEP, fakeOlMap, mapLayer, workspaceWrapper } from "../test/rasterFixtures";
import { useGoneLayers } from "./goneLayers";
import { RasterMount } from "./RasterMount";
import { baseMapRows } from "./rasterRows";

type Spy = ReturnType<typeof vi.fn>;
type FakeLayer = {
  setZIndex: Spy;
  setOpacity: Spy;
  on: Spy;
  un: Spy;
  dispose: Spy;
};
const made: FakeLayer[] = [];
let lastOnGone: (() => void) | null = null;
vi.mock("./makeRasterLayer", () => ({
  makeRasterLayer: (_src: unknown, ctx: { onGone: () => void }) => {
    lastOnGone = ctx.onGone;
    const l = {
      setZIndex: vi.fn(),
      setOpacity: vi.fn(),
      on: vi.fn(),
      un: vi.fn(),
      dispose: vi.fn(),
    };
    made.push(l);
    return l;
  },
}));

type Props = ComponentProps<typeof RasterMount>;
const [row] = baseMapRows({ layers: [mapLayer("sep", SEP)] });

function mount(stores = makeStores(), base: Partial<Props> = {}) {
  const map = fakeOlMap();
  let renders = 0;
  const ui = (p: Partial<Props>) => (
    <Profiler id="mount" onRender={() => void renders++}>
      <RasterMount
        row={row}
        map={map as never}
        side="right"
        zIndex={3}
        opacity={1}
        style={{}}
        projectId="p"
        frame={UTM33}
        {...base}
        {...p}
      />
    </Profiler>
  );
  // A wrapper, not renderInWorkspace: its `rerender` drops the providers (recon §0.4).
  const view = render(ui({}), { wrapper: workspaceWrapper(stores) });
  return {
    map,
    rerender: (p: Partial<Props>) => view.rerender(ui(p)),
    renders: () => renders,
    unmount: view.unmount,
  };
}

describe("RasterMount", () => {
  beforeEach(() => {
    made.length = 0;
    useGoneLayers.setState({ gone: new Set() });
  });

  it("adds one layer, updates z and opacity in place, removes it on unmount", () => {
    const { map, rerender, unmount } = mount();
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    rerender({ zIndex: 7, opacity: 0.4 });
    expect(made).toHaveLength(1);
    expect(made[0].setZIndex).toHaveBeenLastCalledWith(7);
    expect(made[0].setOpacity).toHaveBeenLastCalledWith(0.4);
    unmount();
    expect(map.removeLayer).toHaveBeenCalledTimes(1);
    expect(made[0].dispose).toHaveBeenCalled();
  });

  it("frame budget: 100 opacity changes never rebuild the layer", () => {
    const { map, rerender } = mount();
    for (let i = 0; i < 100; i++) rerender({ opacity: i / 100 });
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("rebuilds only when the source changes", () => {
    const { map, rerender } = mount();
    rerender({ style: { render: "tint" } }); // a map ignores surface styles
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    rerender({ row: { ...row, version: "2" } });
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(made[0].dispose).toHaveBeenCalled();
  });

  it("frame budget: in Swipe it clips its side and 60 divider moves redraw without re-rendering", () => {
    const stores = makeStores();
    act(() => stores.workspace.getState().setMode("swipe"));
    const { map, renders } = mount(stores);
    expect(made[0].on).toHaveBeenCalledWith("prerender", expect.any(Function));
    const before = renders();
    map.render.mockClear();
    act(() => {
      for (let i = 0; i < 60; i++) stores.workspace.getState().setSwipe(10 + i);
    });
    expect(map.render).toHaveBeenCalledTimes(60);
    expect(renders()).toBe(before);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it("does not clip an undated overlay, nor outside Swipe", () => {
    const stores = makeStores();
    act(() => stores.workspace.getState().setMode("swipe"));
    mount(stores, { side: "both" });
    expect(made[0].on).not.toHaveBeenCalled();
    const blend = makeStores();
    act(() => blend.workspace.getState().setMode("blend"));
    mount(blend);
    expect(made[1].on).not.toHaveBeenCalled();
  });

  it("drops its layer when its tiles answer 404", () => {
    const { map } = mount();
    act(() => lastOnGone?.());
    expect(useGoneLayers.getState().gone.has("map:sep")).toBe(true);
    expect(map.removeLayer).toHaveBeenCalledTimes(1);
  });

  it("clips a left-date row to the left side in Swipe", () => {
    const stores = makeStores();
    act(() => stores.workspace.getState().setMode("swipe"));
    const [left] = baseMapRows({ layers: [mapLayer("aug", AUG)] });
    mount(stores, { row: left, side: "left" });
    expect(made[0].on).toHaveBeenCalledTimes(2); // prerender + postrender
  });
});
