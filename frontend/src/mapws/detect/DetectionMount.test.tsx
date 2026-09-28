import { act, render, waitFor } from "@testing-library/react";
import type OlMap from "ol/Map";
import type VectorLayer from "ol/layer/Vector";
import { get as getProjection } from "ol/proj";
import type VectorSource from "ol/source/Vector";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSiteDensity, fetchSiteDetections, type MapDetection } from "@/api/mapDetect";
import type { LayerRow } from "@/mapws/w4host";
import { PROJECT_ID, exampleMapRun, fakeClient } from "@/test/fixtures";
import { makeStores } from "../test/harness";
import { UTM33, survey } from "../test/fixtures";
import { surveyMap, workspaceWrapper } from "../test/rasterFixtures";
import { DetectionMount } from "./DetectionMount";
import { DEFAULT_FILTERS } from "./detectModel";
import { useDetectStore } from "./detectStore";

const MAP_ID = "map1";
const DATE = "2026-09-14";
const PROJ = getProjection("EPSG:3857")!;

vi.mock("@/mapws/w4host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/mapws/w4host")>();
  // Detection Mounts render inside SiteMap's PaneContext, which isn't exported for tests; the
  // pane's `map` field isn't read by DetectionMount (it uses the `map` prop), only `side` is.
  return { ...actual, useMapPane: () => ({ side: "single" }) };
});

vi.mock("@/api/mapDetect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mapDetect")>();
  return { ...actual, fetchSiteDetections: vi.fn(), fetchSiteDensity: vi.fn() };
});

vi.mock("@/api/maps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/maps")>();
  return { ...actual, listMapRuns: vi.fn(async () => [exampleMapRun]) };
});

vi.mock("@/findings/useProjectTypes", () => ({
  useProjectTypes: () => ({ loaded: true, types: new Map(), defectTypes: [], all: [] }),
}));

const ROW: LayerRow = {
  key: "detections:detections",
  kind: "detections",
  group: "annotations",
  id: "detections",
  name: "AI detections",
  meta: "",
  date: null,
};

const DETECTION: MapDetection = {
  id: "d1",
  review_state: "unreviewed",
  provenance_kind: "local_model",
  class_id: "c1",
  confidence: 0.9,
  x: 10,
  y: 10,
  w: 5,
  h: 5,
  angle: null,
  corners_site: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
};

function fakeMap() {
  return {
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    render: vi.fn(),
    getView: () => ({ calculateExtent: () => [0, 0, 100, 100] }),
    getSize: () => [800, 600],
    on: vi.fn(),
    un: vi.fn(),
  };
}

function mount(map: ReturnType<typeof fakeMap>, opacity = 1) {
  const stores = makeStores({ surveys: [survey(DATE, { maps: [surveyMap(MAP_ID)] })] });
  const api = fakeClient([]).api;
  const ui = (o: number) => (
    <DetectionMount
      row={ROW}
      map={map as unknown as OlMap}
      side="both"
      zIndex={5}
      opacity={o}
      style={{}}
      projectId={PROJECT_ID}
      frame={UTM33}
    />
  );
  const view = render(ui(opacity), { wrapper: workspaceWrapper(stores, { api }) });
  return { rerender: (o: number) => view.rerender(ui(o)) };
}

/** The build effect adds a region-outlines layer first, then each run's box and dot layers. */
async function layersOf(map: ReturnType<typeof fakeMap>) {
  await waitFor(() => expect(map.addLayer).toHaveBeenCalledTimes(3));
  const boxLayer = map.addLayer.mock.calls[1][0] as VectorLayer<VectorSource>;
  const dotLayer = map.addLayer.mock.calls[2][0] as VectorLayer<VectorSource>;
  return { boxLayer, dotLayer };
}

describe("DetectionMount / RunLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDetectStore.setState({
      filters: DEFAULT_FILTERS,
      byId: new Map(),
      inView: {},
      revision: 0,
      history: [],
      outlines: [],
      regionDraft: null,
    });
  });

  it("shows density dots for a truncated wide view, then boxes once a narrower extent is not truncated", async () => {
    const map = fakeMap();
    vi.mocked(fetchSiteDetections).mockResolvedValueOnce({ items: [], truncated: true });
    vi.mocked(fetchSiteDensity).mockResolvedValueOnce({ cell_size: 100, cells: [] });
    mount(map);
    const { boxLayer, dotLayer } = await layersOf(map);

    const wideExtent = [0, 0, 1000, 1000];
    await act(async () => {
      boxLayer.getSource()!.loadFeatures(wideExtent, 10, PROJ);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(boxLayer.getVisible()).toBe(false);
    expect(dotLayer.getVisible()).toBe(true);
    expect(fetchSiteDetections).toHaveBeenCalledTimes(1);
    // The truncated extent must not count as reviewable in-view detections.
    expect(useDetectStore.getState().inView[exampleMapRun.id]).toEqual([]);

    // Zooming into a smaller extent inside the wide (truncated) one: because the wide extent was
    // never recorded as "loaded" (removeLoadedExtent), OL's bbox strategy fetches again instead
    // of treating it as already covered.
    vi.mocked(fetchSiteDetections).mockResolvedValueOnce({ items: [DETECTION], truncated: false });
    const smallExtent = [400, 400, 500, 500];
    await act(async () => {
      boxLayer.getSource()!.loadFeatures(smallExtent, 1, PROJ);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSiteDetections).toHaveBeenCalledTimes(2);
    expect(boxLayer.getVisible()).toBe(true);
    expect(dotLayer.getVisible()).toBe(false);
    expect(boxLayer.getSource()!.getFeatures()).toHaveLength(1);
  });

  it("an opacity change applies in place without rebuilding the layers or re-fetching (T11-3)", async () => {
    const map = fakeMap();
    vi.mocked(fetchSiteDetections).mockResolvedValue({ items: [], truncated: false });
    const { rerender } = mount(map, 1);
    const { boxLayer, dotLayer } = await layersOf(map);

    await act(async () => {
      boxLayer.getSource()!.loadFeatures([0, 0, 10, 10], 1, PROJ);
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsBefore = vi.mocked(fetchSiteDetections).mock.calls.length;

    rerender(0.4);
    await act(async () => {
      await Promise.resolve();
    });

    expect(map.addLayer).toHaveBeenCalledTimes(3); // no new layer built
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(boxLayer.getOpacity()).toBeCloseTo(0.4);
    expect(dotLayer.getOpacity()).toBeCloseTo(0.4);
    expect(vi.mocked(fetchSiteDetections).mock.calls.length).toBe(callsBefore);
  });
});
