import type { ComponentProps } from "react";
import { act, render, waitFor } from "@testing-library/react";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import Modify from "ol/interaction/Modify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Surface } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleMeasurement, exampleSurface, MEASUREMENT_ID } from "@/test/volumeFixtures";
import { useToastStore } from "@/ui/toastStore";
import { makeStores } from "../test/harness";
import { UTM33 } from "../test/fixtures";
import { fakeOlMap, workspaceWrapper } from "../test/rasterFixtures";
import { VolumeMount } from "./VolumeMount";
import { useVolumeStore } from "./volumeStore";

vi.mock("@/app/diagnostics", async (orig) => ({ ...(await orig<object>()), pushLog: vi.fn() }));
vi.mock("@/mapws/w4host", async (orig) => ({
  ...(await orig<object>()),
  useMapPane: () => ({ map: null, side: "single" }),
}));

const inFrame: Surface = { ...exampleSurface, epsg: 32633, crs_wkt: UTM33.crs_wkt };
const routes = (surfaces: Surface[] = [inFrame]): FakeRoute[] => [
  { method: "GET", path: /\/surfaces$/, body: { items: surfaces } },
  { method: "GET", path: /\/volumes$/, body: { items: [exampleMeasurement] } },
];

type Props = ComponentProps<typeof VolumeMount>;

function mount(routeList: FakeRoute[], stores = makeStores()) {
  const map = { ...fakeOlMap(), addInteraction: vi.fn(), removeInteraction: vi.fn() };
  const { api, requests } = fakeClient(routeList);
  const ui = (p: Partial<Props>) => (
    <VolumeMount
      row={{} as never}
      map={map as never}
      side="both"
      zIndex={5}
      opacity={1}
      style={{}}
      projectId="p"
      frame={UTM33}
      {...p}
    />
  );
  const view = render(ui({}), { wrapper: workspaceWrapper(stores, { api }) });
  return {
    map,
    stores,
    requests,
    rerender: (p: Partial<Props>) => view.rerender(ui(p)),
    unmount: view.unmount,
  };
}

const added = (map: ReturnType<typeof fakeOlMap>, kind: typeof VectorLayer | typeof TileLayer) =>
  map.addLayer.mock.calls.map((c) => c[0]).filter((l) => l instanceof kind);

describe("VolumeMount", () => {
  beforeEach(() => {
    vi.mocked(pushLog).mockClear();
    useToastStore.setState({ toasts: [] });
    useVolumeStore.setState({ heatmap: true, drawing: null });
  });

  it("draws the polygons in-frame without a site read, and opacity does not rebuild the layers", async () => {
    const { map, rerender, requests, unmount } = mount(routes());
    await waitFor(() => expect(requests.some((r) => r.url.includes("/volumes"))).toBe(true));
    const vectors = added(map, VectorLayer) as VectorLayer[];
    expect(vectors).toHaveLength(2);
    await waitFor(() => expect(vectors[1].getSource()?.getFeatures()).toHaveLength(1));
    expect(requests.some((r) => r.url.includes("frame=site"))).toBe(false);
    rerender({ opacity: 0.3, zIndex: 9 });
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(vectors.every((l) => l.getOpacity() === 0.3 && l.getZIndex() === 9)).toBe(true);
    unmount();
    expect(map.removeLayer).toHaveBeenCalledTimes(2);
  });

  it("reads ?frame=site when the top is in another CRS", async () => {
    const siteRing = [
      [1, 1],
      [5, 1],
      [5, 5],
    ];
    const { map, requests } = mount([
      ...routes([exampleSurface]),
      {
        method: "GET",
        path: /\/volumes\/[^/]+$/,
        body: { ...exampleMeasurement, polygon_site: siteRing },
      },
    ]);
    await waitFor(() => expect(requests.some((r) => r.url.includes("frame=site"))).toBe(true));
    const polys = (added(map, VectorLayer) as VectorLayer[])[1];
    await waitFor(() => expect(polys.getSource()?.getFeatures()).toHaveLength(1));
  });

  it("drops only the measurement whose site read fails and draws the rest", async () => {
    const other = { ...exampleMeasurement, id: "v-gone", name: "Pile 2" };
    const { map } = mount([
      { method: "GET", path: /\/surfaces$/, body: { items: [exampleSurface] } },
      { method: "GET", path: /\/volumes$/, body: { items: [exampleMeasurement, other] } },
      { method: "GET", path: /\/volumes\/v-gone/, status: 404, body: { detail: "gone" } },
      {
        method: "GET",
        path: /\/volumes\/v0/,
        body: { ...exampleMeasurement, polygon_site: exampleMeasurement.polygon_native },
      },
    ]);
    const polys = (added(map, VectorLayer) as VectorLayer[])[1];
    await waitFor(() => expect(pushLog).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        polys
          .getSource()
          ?.getFeatures()
          .map((f) => f.getId()),
      ).toEqual([MEASUREMENT_ID]),
    );
  });

  it("a failed vertex save toasts and re-reads the volumes so the polygon reverts", async () => {
    const stores = makeStores();
    const { map, requests } = mount(
      [...routes(), { method: "PATCH", path: /\/volumes\//, status: 500, body: { detail: "boom" } }],
      stores,
    );
    act(() => stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID }));
    await waitFor(() => expect(map.addInteraction).toHaveBeenCalled());
    const lists = () => requests.filter((r) => r.method === "GET" && /\/volumes$/.test(r.url)).length;
    const before = lists();
    const modify = map.addInteraction.mock.calls.at(-1)?.[0] as Modify;
    act(() => void modify.dispatchEvent("modifyend"));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    await waitFor(() => expect(lists()).toBe(before + 1));
    expect(requests.find((r) => r.method === "PATCH")?.body).toHaveProperty("polygon_site");
  });

  it("shows the selected measurement's heatmap clamped to its ring, edits only it, and opacity keeps the tiles", async () => {
    const stores = makeStores();
    const { map, rerender } = mount(routes(), stores);
    act(() => stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID }));
    await waitFor(() => expect(added(map, TileLayer)).toHaveLength(1));
    const heat = added(map, TileLayer)[0] as TileLayer;
    expect(heat.getExtent()).toEqual([500010, 3299970, 500030, 3299990]);
    expect(heat.getZIndex()).toBe(4);
    await waitFor(() => expect(map.addInteraction).toHaveBeenCalled());
    expect(map.addInteraction.mock.calls.at(-1)?.[0]).toBeInstanceOf(Modify);
    rerender({ opacity: 0.5 });
    expect(added(map, TileLayer)).toHaveLength(1);
    expect(heat.getOpacity()).toBe(0.5);
  });

  it("draws the selected measurement's footprints and re-reads them when findings change", async () => {
    const withRun = {
      ...exampleMeasurement,
      masks: { ...exampleMeasurement.masks, detection_run_ids: ["r1"] },
    };
    const stores = makeStores();
    const { map, requests } = mount(
      [
        { method: "GET", path: /\/surfaces$/, body: { items: [inFrame] } },
        { method: "GET", path: /\/volumes$/, body: { items: [withRun] } },
        {
          method: "GET",
          path: /\/footprints/,
          body: {
            items: [{ ring_site: exampleMeasurement.polygon_native }, { ring_site: null }],
            truncated: false,
          },
        },
      ],
      stores,
    );
    act(() => stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID }));
    const maskLayer = (added(map, VectorLayer) as VectorLayer[])[0];
    await waitFor(() =>
      expect(
        maskLayer
          .getSource()
          ?.getFeatures()
          .map((f) => f.get("role")),
      ).toEqual(["footprint"]),
    );
    const reads = () => requests.filter((r) => r.url.includes("/footprints?frame=site")).length;
    expect(reads()).toBe(1);
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("logs a background load failure instead of a danger toast", async () => {
    mount([{ method: "GET", path: /\/surfaces$/, status: 500, body: { detail: "boom" } }]);
    await waitFor(() => expect(pushLog).toHaveBeenCalled());
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
