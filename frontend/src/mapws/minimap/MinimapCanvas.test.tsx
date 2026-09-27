import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID } from "@/test/fixtures";
import { baseMapRows } from "../layers/rasterRows";
import { UTM33 } from "../test/fixtures";
import { makeStores } from "../test/harness";
import { AUG, SEP, mapLayer, workspaceWrapper } from "../test/rasterFixtures";
import { MinimapCanvas } from "./MinimapCanvas";

const { maps, built, FakeMap } = vi.hoisted(() => {
  const maps: InstanceType<typeof FakeMap>[] = [];
  const built: { id: string; dispose: () => void; disposed: number }[] = [];
  class FakeMap {
    layers: unknown[] = [];
    disposed = false;
    fitCalls: unknown[][] = [];
    constructor(opts: { layers: unknown[] }) {
      this.layers = [...opts.layers];
      maps.push(this);
    }
    addLayer(l: unknown) {
      this.layers.push(l);
    }
    removeLayer(l: unknown) {
      this.layers = this.layers.filter((x) => x !== l);
    }
    getView() {
      return {
        getProjection: () => "EPSG:32633",
        fit: (...a: unknown[]) => this.fitCalls.push(a),
      };
    }
    getSize() {
      return [172, 110];
    }
    getEventCoordinate() {
      return [7, 9];
    }
    setTarget() {}
    dispose() {
      this.disposed = true;
    }
  }
  return { maps, built, FakeMap };
});
vi.mock("ol/Map", () => ({ default: FakeMap }));
vi.mock("../layers/makeRasterLayer", () => ({
  makeRasterLayer: (src: { id: string }) => {
    const l = {
      id: src.id,
      disposed: 0,
      dispose() {
        l.disposed += 1;
      },
    };
    built.push(l);
    return l;
  },
}));

const rows = baseMapRows({ layers: [mapLayer("aug", AUG), mapLayer("sep", SEP)] });
const live = () => maps.filter((m) => !m.disposed);

function renderCanvas(ortho = rows[0], onRecentre = vi.fn()) {
  const wrapper = workspaceWrapper(makeStores());
  const ui = (o: typeof ortho) => (
    <StrictMode>
      <MinimapCanvas
        frame={UTM33}
        projectId={PROJECT_ID}
        ortho={o}
        extent={[0, 0, 100, 100]}
        ring={null}
        onRecentre={onRecentre}
      />
    </StrictMode>
  );
  const out = render(ui(ortho), { wrapper });
  return { ...out, rerenderWith: (o: typeof ortho) => out.rerender(ui(o)), onRecentre };
}

describe("MinimapCanvas", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    maps.length = 0;
    built.length = 0;
  });

  it("keeps one live map with one ortho layer under StrictMode, fitted to the site", () => {
    renderCanvas();
    expect(live()).toHaveLength(1);
    const m = live()[0];
    // The box layer plus the one ortho layer.
    expect(m.layers.filter((l) => built.includes(l as never))).toHaveLength(1);
    expect(m.fitCalls.at(-1)).toEqual([[0, 0, 100, 100], { padding: [4, 4, 4, 4], size: [172, 110] }]);
  });

  it("swaps the ortho layer when r's ortho changes and disposes everything on unmount", () => {
    const { rerenderWith, unmount } = renderCanvas(rows[0]);
    const m = live()[0];
    rerenderWith(rows[1]);
    const ortho = m.layers.filter((l) => built.includes(l as never)) as { id: string }[];
    expect(ortho.map((l) => l.id)).toEqual([rows[1].id]);
    unmount();
    expect(live()).toHaveLength(0);
    expect(built.every((l) => l.disposed === 1)).toBe(true);
  });

  it("recentres on press and on drag, not on a bare hover", () => {
    const { onRecentre } = renderCanvas();
    const el = screen.getByTestId("minimap-map");
    fireEvent.pointerMove(el);
    expect(onRecentre).not.toHaveBeenCalled();
    fireEvent.pointerDown(el, { button: 0 });
    fireEvent.pointerMove(el);
    fireEvent.pointerUp(el);
    fireEvent.pointerMove(el);
    expect(onRecentre).toHaveBeenCalledTimes(2);
    expect(onRecentre).toHaveBeenCalledWith([7, 9]);
  });
});
